import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(".");

function run(args, cwd = root) {
  return execFileSync("node", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

test("bootstrap installs generic blueprint into a synthetic target", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-bootstrap-"));

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Synthetic App"
  ]);

  for (const path of [
    "AGENTS.md",
    "CLAUDE.md",
    "docs_project/README.md",
    ".specify/memory/constitution.md",
    ".github/workflows/ai-review.yml",
    "scripts/check-feature-memory.mjs",
    ".unicorn-hub/config.json"
  ]) {
    assert.equal(existsSync(join(target, path)), true, `${path} should exist`);
  }

  const agents = readFileSync(join(target, "AGENTS.md"), "utf8");
  assert.match(agents, /Synthetic App/);
  assert.doesNotMatch(agents, /<PROJECT_NAME>/);

  const config = JSON.parse(readFileSync(join(target, ".unicorn-hub/config.json"), "utf8"));
  assert.equal(config.profile, "generic");
});

test("bootstrapped target passes baseline check", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-baseline-"));

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "static-vercel",
    "--project-name",
    "Static Example"
  ]);

  const output = run(["scripts/check-repo-baseline.mjs", "--target", target]);
  assert.match(output, /Repository baseline check passed/);
});
