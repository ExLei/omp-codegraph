import { test, expect, afterAll } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import codegraphExtension, {
  buildSetupInstructions,
  findIndexRoot,
  findProjectRoot,
  resolveCodegraphCommand,
  runCodegraph,
} from "./codegraph.js";

const tmp = await realpath(await mkdtemp(join(tmpdir(), "cg-test-")));
// root/.codegraph (with index db) + root/.git; deep nesting under root/sub/deeper
await mkdir(join(tmp, "root", ".codegraph"), { recursive: true });
await writeFile(join(tmp, "root", ".codegraph", "codegraph.db"), "");
await mkdir(join(tmp, "root", ".git"), { recursive: true });
await mkdir(join(tmp, "root", "sub", "deeper"), { recursive: true });
await mkdir(join(tmp, "other"), { recursive: true });
const deep = join(tmp, "root", "sub", "deeper");

// Cross-platform CLI stub; every call is logged to $CG_LOG so adapter tests
// can assert the call sequence. Windows gets a standard cmd launcher that the
// extension resolves to Bun + the JS entry without executing cmd.exe.
const callLog = join(tmp, "calls.log");
const savedCallLog = process.env.CG_LOG;
process.env.CG_LOG = callLog;
await mkdir(join(tmp, "bin"), { recursive: true });
const stubCli = join(tmp, "bin", "codegraph.js");
await writeFile(
  stubCli,
  `const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (process.env.CG_LOG) appendFileSync(process.env.CG_LOG, "CALL:" + args.join(" ") + "\\n");
if (args.some((arg) => arg.includes("fail"))) {
  console.log("boom-stdout");
  console.error("boom-stderr");
  process.exitCode = 1;
} else if (args.includes("empty")) {
  console.log("No relevant code found for empty");
} else if (args.includes("both")) {
  console.log("stdout-line");
  console.error("stderr-line");
} else if (args.includes("wait")) {
  setTimeout(() => console.log("waited"), 5_000);
} else {
  console.log("fake-output " + args.join(" "));
}
`,
);

const binCli = join(tmp, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph");
if (process.platform === "win32") {
  await writeFile(binCli, `@"${process.execPath}" "${stubCli}" %*\n`);
} else {
  await writeFile(
    binCli,
    "#!/bin/sh\nexec \"" + process.execPath + "\" \"" + stubCli + "\" \"$@\"\n",
    { mode: 0o755 },
  );
}
const directStubCommand = { file: process.execPath, prefixArgs: [stubCli] };

async function readCalls(): Promise<string[]> {
  try {
    const text = await readFile(callLog, "utf8");
    return text.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

interface StubTool {
  name: string;
  execute(
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: { cwd: string },
  ): Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

// Minimal pi stub: captures registered tools for direct execute() calls. The
// final cast deliberately bridges the many ExtensionAPI members these tests do
// not exercise while keeping the captured tool surface strongly typed.
function stubPi() {
  const tools: StubTool[] = [];
  const z = {
    object: (shape: unknown) => ({ shape }),
    string: () => ({
      describe: () => ({}),
      optional: () => ({ describe: () => ({}) }),
    }),
    number: () => ({ int: () => ({ positive: () => ({ optional: () => ({ describe: () => ({}) }) }) }) }),
    array: () => ({ optional: () => ({ describe: () => ({}) }) }),
    boolean: () => ({ optional: () => ({ describe: () => ({}) }) }),
  };
  const pi = {
    zod: { z },
    setLabel: () => {},
    registerTool: (t: StubTool) => {
      tools.push(t);
    },
  } as unknown as ExtensionAPI;
  return { tools, pi };
}

async function withPath(pathValue: string, fn: () => void | Promise<void>): Promise<void> {
  const saved = process.env.PATH;
  process.env.PATH = pathValue;
  try {
    await fn();
  } finally {
    process.env.PATH = saved;
  }
}

afterAll(async () => {
  if (savedCallLog === undefined) delete process.env.CG_LOG;
  else process.env.CG_LOG = savedCallLog;
  await rm(tmp, { recursive: true, force: true });
});

// ── find-root ────────────────────────────────────────────────────────────────

test("findIndexRoot walks up to the .codegraph marker", async () => {
  expect(await findIndexRoot(deep)).toBe(join(tmp, "root"));
  expect(await findIndexRoot(join(tmp, "root", ".codegraph"))).toBe(join(tmp, "root"));
});

test("findIndexRoot returns null when no marker exists", async () => {
  expect(await findIndexRoot(join(tmp, "other"))).toBeNull();
});

test("findIndexRoot ignores a bare .codegraph dir (CLI telemetry false positive)", async () => {
  // The codegraph CLI keeps telemetry in ~/.codegraph without a db file; a
  // bare directory must not count as an index.
  await mkdir(join(tmp, "tel", ".codegraph"), { recursive: true });
  expect(await findIndexRoot(join(tmp, "tel"))).toBeNull();
});

test("findIndexRoot requires codegraph.db to be a file", async () => {
  await mkdir(join(tmp, "invalid-index", ".codegraph", "codegraph.db"), { recursive: true });
  expect(await findIndexRoot(join(tmp, "invalid-index"))).toBeNull();
});

test("findProjectRoot walks up to the .git entry", async () => {
  expect(await findProjectRoot(deep)).toBe(join(tmp, "root"));
});

test("findProjectRoot falls back to the resolved start when no .git exists", async () => {
  expect(await findProjectRoot(join(tmp, "other"))).toBe(join(tmp, "other"));
});

// ── run-codegraph ────────────────────────────────────────────────────────────

test("resolveCodegraphCommand finds the CLI on PATH", async () => {
  await withPath(join(tmp, "bin"), () => {
    expect(resolveCodegraphCommand()).toEqual(
      process.platform === "win32"
        ? directStubCommand
        : { file: binCli, prefixArgs: [] },
    );
  });
});

test("resolveCodegraphCommand returns the bare name when PATH has none", async () => {
  await withPath(join(tmp, "empty"), () => {
    expect(resolveCodegraphCommand()).toEqual({ file: "codegraph", prefixArgs: [] });
  });
});

test("resolveCodegraphCommand safely follows nested Windows cmd shims", async () => {
  if (process.platform !== "win32") return;
  const shimDir = join(tmp, "nested-bin");
  const runtimeDir = join(tmp, "runtime", "bin");
  await mkdir(shimDir, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  const innerShim = join(runtimeDir, "codegraph.cmd");
  await writeFile(innerShim, `@"${process.execPath}" --smol "${stubCli}" %*\n`);
  await writeFile(join(shimDir, "codegraph.cmd"), `@"${innerShim}" %*\n`);

  await withPath(shimDir, () => {
    expect(resolveCodegraphCommand()).toEqual({
      file: process.execPath,
      prefixArgs: ["--smol", stubCli],
    });
  });
});

test("resolveCodegraphCommand rejects unknown Windows cmd shim formats", async () => {
  if (process.platform !== "win32") return;
  const shimDir = join(tmp, "unsupported-bin");
  await mkdir(shimDir, { recursive: true });
  await writeFile(join(shimDir, "codegraph.cmd"), "@echo unsupported %*\n");
  await withPath(shimDir, () => {
    expect(() => resolveCodegraphCommand()).toThrow(/could not be resolved safely/);
  });
});

test("runCodegraph returns trimmed combined output on success", async () => {
  expect(await runCodegraph(["explore", "hello world"], tmp, { command: directStubCommand })).toBe(
    "fake-output explore hello world",
  );
});

test("runCodegraph preserves stdout and stderr on success", async () => {
  const out = await runCodegraph(["explore", "both"], tmp, { command: directStubCommand });
  expect(out).toContain("stdout-line");
  expect(out).toContain("stderr-line");
});

test("runCodegraph rethrows with captured stdout and stderr embedded", async () => {
  const call = runCodegraph(["explore", "fail"], tmp, { command: directStubCommand });
  await expect(call).rejects.toThrow(/boom-stdout[\s\S]*boom-stderr/);
});

test("runCodegraph passes shell metacharacters as literal args (no injection)", async () => {
  // A shell would interpret `; echo PWNED`; argv passing must not.
  const out = await runCodegraph(["explore", "a; echo PWNED & whoami"], tmp, {
    command: directStubCommand,
  });
  expect(out).toContain("a; echo PWNED & whoami");
  expect(out).not.toContain("PWNED\n");
});

test("runCodegraph resolves from PATH when no binary is injected", async () => {
  await withPath(join(tmp, "bin"), async () => {
    expect(await runCodegraph(["explore", "x"], tmp)).toBe("fake-output explore x");
  });
});

test("runCodegraph honors cancellation", async () => {
  const controller = new AbortController();
  const call = runCodegraph(["wait"], tmp, { command: directStubCommand, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await expect(call).rejects.toThrow();
});

// ── guidance ─────────────────────────────────────────────────────────────────

test("setup instructions carry the init command with the project root", () => {
  expect(buildSetupInstructions("/repo/root")).toContain("codegraph init '/repo/root'");
});

test("setup instructions mention .gitignore and the status polling hint", () => {
  const g = buildSetupInstructions("/repo/root");
  expect(g).toContain(".gitignore");
  expect(g).toContain("codegraph status '/repo/root'");
});

test("setup instructions counter the CLI agent-guard boilerplate", () => {
  const g = buildSetupInstructions("/repo/root");
  expect(g).toContain("indexing is the user's decision");
  expect(g).toContain("ignore it and initialize");
});

// ── adapter (tools registered through a stub pi) ──────────────────────────────

test("explore syncs the index before querying", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[0].execute("id", { query: "x" }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    expect(r.content[0].text).toBe("fake-output explore -- x");
  });
  const calls = await readCalls();
  expect(calls[calls.length - 2]).toContain("sync");
  expect(calls[calls.length - 1]).toBe("CALL:explore -- x");
});

test("explore passes maxFiles through to the CLI", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    await tools[0].execute("id", { query: "x", maxFiles: 3 }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
  });
  const calls = await readCalls();
  expect(calls[calls.length - 1]).toBe("CALL:explore --max-files=3 -- x");
});

test("codegraph_node tool runs a focused query", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  expect(tools.map((t) => t.name)).toEqual([
    "codegraph_explore",
    "codegraph_node",
    "codegraph_sync",
    "codegraph_init",
  ]);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[1].execute("id", { name: "runCodegraph" }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    expect(r.content[0].text).toBe("fake-output node -- runCodegraph");
  });
  const calls = await readCalls();
  expect(calls[calls.length - 2]).toContain("sync");
  expect(calls[calls.length - 1]).toBe("CALL:node -- runCodegraph");
});

test("no index returns setup instructions without syncing", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[0].execute("id", { query: "x" }, undefined, undefined, {
      cwd: join(tmp, "other"),
    });
    expect(r.content[0].text).toContain("No codegraph index exists");
  });
});

test("sync tool without an index returns setup instructions", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  const before = (await readCalls()).length;
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[2].execute("id", {}, undefined, undefined, {
      cwd: join(tmp, "other"),
    });
    expect(r.content[0].text).toContain("No codegraph index exists");
  });
  // no CLI call was made
  expect((await readCalls()).length).toBe(before);
});

test("no-match explore output carries follow-up guidance", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[0].execute("id", { query: "empty" }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    expect(r.content[0].text).toContain("No relevant matches found");
  });
});

test("init tool runs without an index and never syncs", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  const before = (await readCalls()).length;
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[3].execute("id", { path: join(tmp, "other") }, undefined, undefined, {
      cwd: join(tmp, "other"),
    });
    expect(r.content[0].text).toBe("fake-output init -- " + join(tmp, "other"));
  });
  const calls = await readCalls();
  expect(calls.slice(before)).toEqual(["CALL:init -- " + join(tmp, "other")]);
});

test("sync tool runs without a preceding sync", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  const before = (await readCalls()).length;
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[2].execute("id", {}, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    expect(r.content[0].text).toBe("fake-output sync -- " + join(tmp, "root"));
  });
  const calls = await readCalls();
  expect(calls.slice(before)).toEqual(["CALL:sync -- " + join(tmp, "root")]);
});

test("sync tool pins the index root found on the lexical chain", async () => {
  // Symlinked cwd: unpinned `codegraph sync` resolves realpath only and
  // misses the lexical-chain index; the tool must pin the found root.
  const link = join(tmp, "sync-link");
  await symlink(join(tmp, "root"), link);
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[2].execute("id", {}, undefined, undefined, { cwd: link });
    expect(r.content[0].text).toBe("fake-output sync -- " + link);
  });
  const calls = await readCalls();
  expect(calls[calls.length - 1]).toBe("CALL:sync -- " + link);
});

test("init without path targets the project root, not cwd", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[3].execute("id", {}, undefined, undefined, { cwd: deep });
    expect(r.content[0].text).toBe("fake-output init -- " + join(tmp, "root"));
  });
  const calls = await readCalls();
  expect(calls[calls.length - 1]).toBe("CALL:init -- " + join(tmp, "root"));
});

test("init passes force through", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[3].execute("id", { force: true }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    expect(r.content[0].text).toBe("fake-output init --force -- " + join(tmp, "root"));
  });
  const calls = await readCalls();
  expect(calls[calls.length - 1]).toBe("CALL:init --force -- " + join(tmp, "root"));
});

test("all 4 tools are registered and active", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  expect(tools).toHaveLength(4);
  expect(tools.every((t) => !("defaultInactive" in t))).toBe(true);
});

test("findIndexRoot resolves a symlinked cwd to the real index", async () => {
  const link = join(tmp, "link-root");
  await symlink(join(tmp, "root"), link);
  const result = await findIndexRoot(link);
  // 词法链优先：link/.codegraph 经 symlink 穿透即可见，命中 link 本身；
  // 若词法不可达则 real 链命中 root。两者都指向同一真实索引。
  expect(result === link || result === join(tmp, "root")).toBe(true);
});

test("failed sync flags the result as possibly stale", async () => {
  // 索引目录路径含 "fail" → stub 的 sync 调用失败 → 查询仍执行但带提示
  await mkdir(join(tmp, "fail-root", ".codegraph"), { recursive: true });
  await writeFile(join(tmp, "fail-root", ".codegraph", "codegraph.db"), "");
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[0].execute("id", { query: "x" }, undefined, undefined, {
      cwd: join(tmp, "fail-root"),
    });
    expect(r.content[0].text).toContain("⚠ codegraph sync failed — blast radius may be stale.");
    expect(r.content[0].text).toContain("boom-stderr");
    expect(r.content[0].text).toContain("fake-output explore -- x");
  });
});

test("findIndexRoot sees markers above a link component (lexical chain)", async () => {
  const target = join(tmp, "link-target");
  await mkdir(target, { recursive: true });
  const linkParent = join(tmp, "linkdir");
  await mkdir(linkParent, { recursive: true });
  await symlink(target, join(linkParent, "proj"));
  await mkdir(join(linkParent, ".codegraph"), { recursive: true });
  await writeFile(join(linkParent, ".codegraph", "codegraph.db"), "");
  expect(await findIndexRoot(join(linkParent, "proj"))).toBe(linkParent);
});

test("setup instructions quote project roots containing single quotes", () => {
  const g = buildSetupInstructions("/repo/it's");
  expect(g).toContain("codegraph init '/repo/it'\\''s'");
});

test("dash-leading user args are protected from CLI option parsing", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    await tools[0].execute("id", { query: "--help" }, undefined, undefined, { cwd: join(tmp, "root") });
    await tools[0].execute("id", { query: "--max-files", maxFiles: 3 }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    await tools[1].execute("id", { name: "-h" }, undefined, undefined, { cwd: join(tmp, "root") });
  });
  const calls = (await readCalls()).filter((c) => !c.includes("sync")).slice(-3);
  expect(calls).toEqual([
    "CALL:explore -- --help",
    "CALL:explore --max-files=3 -- --max-files",
    "CALL:node -- -h",
  ]);
});
