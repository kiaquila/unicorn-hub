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
  assert.equal(config.requiredChecks.includes("guard"), true);
  assert.equal(config.requiredChecks.includes("AI Review"), true);
  assert.equal(config.commands.lint, "make check");
  assert.equal(config.commands.preflight, "pnpm run preflight");

  const packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  assert.match(packageJson.scripts.preflight, /pnpm run check:flutter/);
  assert.equal(packageJson.scripts["check:flutter"], "make check && make test");

  const dependabot = readFileSync(join(target, ".github/dependabot.yml"), "utf8");
  assert.match(dependabot, /package-ecosystem: "github-actions"/);
  assert.match(dependabot, /package-ecosystem: "pub"/);
  assert.doesNotMatch(dependabot, /package-ecosystem: "npm"/);
});

test("bootstrap into a fresh Flutter target excludes the default Node CI workflow", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-flutter-fresh-"));
  writeFileSync(join(target, "pubspec.yaml"), "name: synthetic_flutter_app\n");

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "flutter-app",
    "--project-name",
    "Fresh Flutter App"
  ]);

  assert.equal(
    existsSync(join(target, ".github/workflows/ci.yml")),
    false,
    "default Node ci.yml must not be installed for the flutter-app profile"
  );
  assert.equal(existsSync(join(target, ".github/workflows/pr-guard.yml")), true);
  assert.equal(existsSync(join(target, ".github/workflows/ai-review.yml")), true);
  assert.equal(existsSync(join(target, ".github/workflows/osv-scan.yml")), true);

  const config = JSON.parse(readFileSync(join(target, ".unicorn-hub/config.json"), "utf8"));
  assert.equal(config.requiredChecks.includes("baseline-checks"), false);
  assert.deepEqual(config.excludeTemplates, [".github/workflows/ci.yml"]);

  const baselineOutput = run(["scripts/check-repo-baseline.mjs", "--target", target]);
  assert.match(
    baselineOutput,
    /Repository baseline check passed/,
    "fresh Flutter target must pass baseline without an installed ci.yml"
  );
});

test("bootstrap with --force still preserves Flutter ci.yml via excludeTemplates", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-flutter-force-"));
  mkdirSync(join(target, ".github/workflows"), { recursive: true });
  writeFileSync(join(target, ".github/workflows/ci.yml"), "name: Existing Flutter CI\n");
  writeFileSync(join(target, "pubspec.yaml"), "name: synthetic_flutter_app\n");

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "flutter-app",
    "--project-name",
    "Force Flutter App",
    "--force"
  ]);

  assert.equal(
    readFileSync(join(target, ".github/workflows/ci.yml"), "utf8"),
    "name: Existing Flutter CI\n",
    "excludeTemplates must protect target ci.yml even with --force"
  );
});

test("bootstrap merges profile packageScripts into a pre-existing package.json", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-flutter-existing-pkg-"));
  writeFileSync(join(target, "pubspec.yaml"), "name: synthetic_flutter_app\n");
  writeFileSync(
    join(target, "package.json"),
    `${JSON.stringify(
      {
        name: "existing-app",
        private: true,
        scripts: {
          custom: "echo custom",
          preflight: "echo old-preflight"
        }
      },
      null,
      2
    )}\n`
  );

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "flutter-app",
    "--project-name",
    "Existing Pkg Flutter"
  ]);

  const packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  assert.equal(packageJson.name, "existing-app", "user package.json identity must be preserved");
  assert.equal(packageJson.scripts.custom, "echo custom", "user-defined scripts must be preserved");
  assert.equal(packageJson.scripts["check:flutter"], "make check && make test");
  assert.match(packageJson.scripts.preflight, /pnpm run check:flutter/, "profile preflight must override the user one");
  assert.equal(
    packageJson.scripts["check:repo"],
    "node scripts/check-repo-baseline.mjs",
    "baseline check:repo script must be filled in so the merged preflight can run"
  );
  assert.equal(
    packageJson.scripts["check:feature-memory"],
    "node scripts/check-feature-memory.mjs",
    "baseline check:feature-memory script must be filled in for the merged preflight"
  );
});

test("bootstrap into pre-existing package.json preserves user-defined baseline scripts", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-flutter-preserve-baseline-"));
  writeFileSync(join(target, "pubspec.yaml"), "name: synthetic_flutter_app\n");
  writeFileSync(
    join(target, "package.json"),
    `${JSON.stringify(
      {
        name: "existing-app",
        private: true,
        scripts: {
          "check:repo": "echo user-baseline"
        }
      },
      null,
      2
    )}\n`
  );

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "flutter-app",
    "--project-name",
    "Preserve Baseline Flutter"
  ]);

  const packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["check:repo"],
    "echo user-baseline",
    "user-defined baseline scripts must outrank template defaults"
  );
});
