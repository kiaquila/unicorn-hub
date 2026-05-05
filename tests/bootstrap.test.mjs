import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    ".specify/templates/spec-template.md",
    ".github/pull_request_template.md",
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

  const specTemplate = readFileSync(join(target, ".specify/templates/spec-template.md"), "utf8");
  assert.match(specTemplate, /## Goal/);
  assert.match(specTemplate, /## Negative Scenarios/);

  const prTemplate = readFileSync(join(target, ".github/pull_request_template.md"), "utf8");
  assert.match(prTemplate, /SENAR Done Gate/);
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

test("bootstrap preserves Flutter CI and installs Flutter profile controls", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-flutter-"));
  mkdirSync(join(target, ".github/workflows"), { recursive: true });
  writeFileSync(join(target, ".github/workflows/ci.yml"), "name: Existing Flutter CI\n");
  writeFileSync(join(target, "pubspec.yaml"), "name: synthetic_flutter_app\n");
  writeFileSync(join(target, "Makefile"), "check:\n\tflutter analyze lib test\n");

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "flutter-app",
    "--project-name",
    "Synthetic Flutter App"
  ]);

  assert.equal(readFileSync(join(target, ".github/workflows/ci.yml"), "utf8"), "name: Existing Flutter CI\n");

  const config = JSON.parse(readFileSync(join(target, ".unicorn-hub/config.json"), "utf8"));
  assert.equal(config.profile, "flutter-app");
  assert.deepEqual(config.productPaths.slice(0, 4), ["lib/", "test/", "integration_test/", "test_driver/"]);
  assert.equal(config.requiredChecks.includes("baseline-checks"), false);
  assert.equal(config.requiredChecks.includes("Build Android APK"), true);
  assert.equal(config.commands.preflight.includes("make check"), true);

  const packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.preflight.includes("pnpm run check:flutter"), true);
  assert.equal(packageJson.scripts["check:flutter"], "make check && make test");

  const dependabot = readFileSync(join(target, ".github/dependabot.yml"), "utf8");
  assert.match(dependabot, /package-ecosystem: "github-actions"/);
  assert.match(dependabot, /package-ecosystem: "pub"/);
  assert.doesNotMatch(dependabot, /package-ecosystem: "npm"/);
});
