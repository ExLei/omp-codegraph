import { test, expect, afterAll } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSetupInstructions,
  findIndexRoot,
  findProjectRoot,
  resolveCodegraphBinary,
  runCodegraph,
} from "./codegraph.js";

const tmp = await mkdtemp(join(tmpdir(), "cg-test-"));
// root/.codegraph + root/.git; deep nesting under root/sub/deeper
await mkdir(join(tmp, "root", ".codegraph"), { recursive: true });
await mkdir(join(tmp, "root", ".git"), { recursive: true });
await mkdir(join(tmp, "root", "sub", "deeper"), { recursive: true });
await mkdir(join(tmp, "other"), { recursive: true });
const deep = join(tmp, "root", "sub", "deeper");

// PATH-installed CLI stub (official-installer style)
await mkdir(join(tmp, "bin"), { recursive: true });
const binCli = join(tmp, "bin", "codegraph");
await writeFile(
  binCli,
  "#!/bin/sh\nif echo \"$*\" | grep -q fail; then\n  echo \"boom-stderr\" >&2\n  exit 1\nfi\necho \"fake-output $*\"\n",
  { mode: 0o755 },
);

function withPath(pathValue: string, fn: () => void | Promise<void>) {
  const saved = process.env.PATH;
  process.env.PATH = pathValue;
  try {
    return fn();
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

test("findProjectRoot walks up to the .git entry", async () => {
  expect(await findProjectRoot(deep)).toBe(join(tmp, "root"));
});

test("findProjectRoot falls back to the resolved start when no .git exists", async () => {
  expect(await findProjectRoot(join(tmp, "other"))).toBe(join(tmp, "other"));
});

// ── run-codegraph ────────────────────────────────────────────────────────────

test("resolveCodegraphBinary finds the CLI on PATH", () => {
  withPath(join(tmp, "bin"), () => {
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
  await expect(runCodegraph(["explore", "fail"], "/tmp", 90_000, binCli)).rejects.toThrow(/boom-stderr/);
});

test("runCodegraph passes shell metacharacters as literal args (no injection)", async () => {
  // A shell would interpret `; echo PWNED`; argv passing must not.
  const out = await runCodegraph(["explore", "a; echo PWNED & whoami"], "/tmp", 90_000, binCli);
  expect(out).toContain("a; echo PWNED & whoami");
  expect(out).not.toContain("PWNED\n");
});

test("runCodegraph resolves from PATH when no binary is injected", async () => {
  withPath(join(tmp, "bin"), async () => {
    expect(await runCodegraph(["explore", "x"], "/tmp")).toBe("fake-output explore x");
  });
});

// ── guidance ─────────────────────────────────────────────────────────────────

test("setup instructions carry the init command with the project root", () => {
  expect(buildSetupInstructions("/repo/root")).toContain('codegraph init "/repo/root"');
});

test("setup instructions mention .gitignore and the status polling hint", () => {
  const g = buildSetupInstructions("/repo/root");
  expect(g).toContain(".gitignore");
  expect(g).toContain('codegraph status "/repo/root"');
});

test("setup instructions counter the CLI agent-guard boilerplate", () => {
  const g = buildSetupInstructions("/repo/root");
  expect(g).toContain("indexing is the user's decision");
  expect(g).toContain("ignore it and initialize");
});
