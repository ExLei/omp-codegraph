import { test, expect, afterAll } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import codegraphExtension, {
  buildSetupInstructions,
  findIndexRoot,
  findProjectRoot,
  resolveCodegraphBinary,
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

// PATH-installed CLI stub (official-installer style); every call is logged
// to $CG_LOG so adapter tests can assert the call sequence. Uses only sh
// built-ins — adapter tests replace PATH with a bare dir, so external
// commands like grep would be unfindable.
const callLog = join(tmp, "calls.log");
process.env.CG_LOG = callLog;
await mkdir(join(tmp, "bin"), { recursive: true });
const binCli = join(tmp, "bin", "codegraph");
await writeFile(
  binCli,
  "#!/bin/sh\nif [ -n \"$CG_LOG\" ]; then echo \"CALL:$*\" >> \"$CG_LOG\"; fi\ncase \"$*\" in\n  *fail*)\n    echo \"boom-stderr\" >&2\n    exit 1\n    ;;\n  *empty*)\n    echo \"No relevant code found for empty\"\n    exit 0\n    ;;\nesac\necho \"fake-output $*\"\n",
  { mode: 0o755 },
);

async function readCalls(): Promise<string[]> {
  try {
    const text = await readFile(callLog, "utf8");
    return text.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// Minimal pi stub: captures registered tools for direct execute() calls.
// `pi` is typed `any` — the real ExtensionAPI has ~30 members we don't use.
function stubPi() {
  const tools: Array<{ name: string; execute: Function; defaultInactive?: boolean }> = [];
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
  const pi: any = {
    zod: { z },
    setLabel: () => {},
    registerTool: (t: { name: string; execute: Function }) => {
      tools.push(t);
    },
  };
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

afterAll(() => rm(tmp, { recursive: true, force: true }));

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

test("findProjectRoot walks up to the .git entry", async () => {
  expect(await findProjectRoot(deep)).toBe(join(tmp, "root"));
});

test("findProjectRoot falls back to the resolved start when no .git exists", async () => {
  expect(await findProjectRoot(join(tmp, "other"))).toBe(join(tmp, "other"));
});

// ── run-codegraph ────────────────────────────────────────────────────────────

test("resolveCodegraphBinary finds the CLI on PATH", async () => {
  await withPath(join(tmp, "bin"), () => {
    expect(resolveCodegraphBinary()).toBe(binCli);
  });
});

test("resolveCodegraphBinary returns the bare name when PATH has none", () => {
  withPath(join(tmp, "empty"), () => {
    expect(resolveCodegraphBinary()).toBe("codegraph");
  });
});

test("runCodegraph returns trimmed combined output on success", async () => {
  expect(await runCodegraph(["explore", "hello world"], "/tmp", 90_000, binCli)).toBe(
    "fake-output explore hello world",
  );
});

test("runCodegraph rethrows with captured stderr embedded", async () => {
  // bun:test `.rejects` matchers return void (bun-types) and the runner tracks
  // the assertion internally — `await` is a no-op here (TS 80007).
  expect(runCodegraph(["explore", "fail"], "/tmp", 90_000, binCli)).rejects.toThrow(/boom-stderr/);
});

test("runCodegraph passes shell metacharacters as literal args (no injection)", async () => {
  // A shell would interpret `; echo PWNED`; argv passing must not.
  const out = await runCodegraph(["explore", "a; echo PWNED & whoami"], "/tmp", 90_000, binCli);
  expect(out).toContain("a; echo PWNED & whoami");
  expect(out).not.toContain("PWNED\n");
});

test("runCodegraph resolves from PATH when no binary is injected", async () => {
  await withPath(join(tmp, "bin"), async () => {
    expect(await runCodegraph(["explore", "x"], "/tmp")).toBe("fake-output explore x");
  });
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
    "codegraph_query",
    "codegraph_callers",
    "codegraph_callees",
    "codegraph_impact",
    "codegraph_affected",
    "codegraph_files",
    "codegraph_status",
    "codegraph_sync",
    "codegraph_init",
    "codegraph_index",
    "codegraph_uninit",
    "codegraph_unlock",
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

test("query tool syncs the index and passes search through", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[2].execute("id", { search: "findOnPath", limit: 5 }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    expect(r.content[0].text).toBe("fake-output query --limit=5 -- findOnPath");
  });
  const calls = await readCalls();
  expect(calls[calls.length - 2]).toContain("sync");
  expect(calls[calls.length - 1]).toBe("CALL:query --limit=5 -- findOnPath");
});

test("affected tool passes file list through", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[6].execute("id", { files: ["a.ts", "b.ts"] }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    expect(r.content[0].text).toBe("fake-output affected -- a.ts b.ts");
  });
  const calls = await readCalls();
  expect(calls[calls.length - 1]).toBe("CALL:affected -- a.ts b.ts");
});

test("init tool runs without an index and never syncs", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  const before = (await readCalls()).length;
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[10].execute("id", { path: join(tmp, "other") }, undefined, undefined, {
      cwd: join(tmp, "other"),
    });
    expect(r.content[0].text).toBe("fake-output init -- " + join(tmp, "other"));
  });
  const calls = await readCalls();
  expect(calls.slice(before)).toEqual(["CALL:init -- " + join(tmp, "other")]);
});

test("uninit without an index returns a plain message", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[12].execute("id", {}, undefined, undefined, {
      cwd: join(tmp, "other"),
    });
    expect(r.content[0].text).toBe("No codegraph index found — nothing to remove.");
  });
});

test("status tool does not sync first", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  const before = (await readCalls()).length;
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[8].execute("id", {}, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    expect(r.content[0].text).toBe("fake-output status");
  });
  const calls = await readCalls();
  expect(calls.slice(before)).toEqual(["CALL:status"]);
});

test("init without path targets the project root, not cwd", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r = await tools[10].execute("id", {}, undefined, undefined, { cwd: deep });
    expect(r.content[0].text).toBe("fake-output init -- " + join(tmp, "root"));
  });
  const calls = await readCalls();
  expect(calls[calls.length - 1]).toBe("CALL:init -- " + join(tmp, "root"));
});

test("focused tools pass optional params through", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    await tools[2].execute("id", { search: "x", kind: "class" }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    await tools[3].execute("id", { symbol: "y", limit: 7 }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    await tools[6].execute(
      "id",
      { files: ["f.ts"], depth: 3, filter: "e2e/*.ts" },
      undefined,
      undefined,
      { cwd: join(tmp, "root") },
    );
    await tools[7].execute("id", { pattern: "*.ts", format: "flat" }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    await tools[10].execute("id", { force: true }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
    await tools[13].execute("id", { path: "/p" }, undefined, undefined, {
      cwd: join(tmp, "root"),
    });
  });
  const calls = (await readCalls()).filter((c) => !c.includes("sync")).slice(-6);
  expect(calls).toEqual([
    "CALL:query --kind=class -- x",
    "CALL:callers --limit=7 -- y",
    "CALL:affected --depth=3 --filter=e2e/*.ts -- f.ts",
    "CALL:files --pattern=*.ts --format=flat",
    `CALL:init --force -- ${join(tmp, "root")}`,
    "CALL:unlock -- /p",
  ]);
});

test("default activation split mirrors the official single-tool surface", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  expect(tools.filter((t) => !t.defaultInactive).map((t) => t.name)).toEqual([
    "codegraph_explore",
    "codegraph_node",
    "codegraph_init",
  ]);
  expect(tools.filter((t) => t.defaultInactive).map((t) => t.name)).toEqual([
    "codegraph_query",
    "codegraph_callers",
    "codegraph_callees",
    "codegraph_impact",
    "codegraph_affected",
    "codegraph_files",
    "codegraph_status",
    "codegraph_sync",
    "codegraph_index",
    "codegraph_uninit",
    "codegraph_unlock",
  ]);
});

test("CODEGRAPH_TOOLS=all activates every tool", async () => {
  const saved = process.env.CODEGRAPH_TOOLS;
  process.env.CODEGRAPH_TOOLS = "all";
  try {
    const { tools, pi } = stubPi();
    codegraphExtension(pi);
    expect(tools.every((t) => !t.defaultInactive)).toBe(true);
  } finally {
    process.env.CODEGRAPH_TOOLS = saved;
  }
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
    expect(r.content[0].text).toContain("fake-output explore -- x");
  });
});

test("sync and index tools execute their commands", async () => {
  const { tools, pi } = stubPi();
  codegraphExtension(pi);
  await withPath(join(tmp, "bin"), async () => {
    const r1 = await tools[9].execute("id", {}, undefined, undefined, { cwd: join(tmp, "root") });
    expect(r1.content[0].text).toBe("fake-output sync");
    const r2 = await tools[11].execute("id", {}, undefined, undefined, { cwd: join(tmp, "root") });
    expect(r2.content[0].text).toBe("fake-output index -- " + join(tmp, "root"));
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
