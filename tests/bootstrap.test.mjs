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

  const output = run([
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

  assert.match(output, /CREATE-DOCS\.md/);
  assert.match(output, /docs_project/);
  assert.match(output, /specs\/<feature-id>/);
  assert.match(output, /preflight/);

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
  assert.match(agents, /first setup documentation interview/i);
  assert.match(agents, /CREATE-DOCS\.md/);

  const readme = readFileSync(join(target, "README.md"), "utf8");
  assert.match(readme, /First Setup After Bootstrap/);
  assert.match(readme, /CREATE-DOCS\.md/);

  const claude = readFileSync(join(target, "CLAUDE.md"), "utf8");
  assert.match(claude, /## First Setup/);
  assert.match(claude, /CREATE-DOCS\.md/);

  const docsReadme = readFileSync(join(target, "docs_project/README.md"), "utf8");
  assert.match(docsReadme, /## First Setup/);
  assert.match(docsReadme, /specs\/<feature-id>/);

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
  assert.deepEqual(
    config.requiredChecks,
    ["guard", "AI Review"],
    "flutter-app must ship only Unicorn-controlled checks; teams add real CI job names post-bootstrap"
  );
  for (const guessedJob of ["Lint", "Unit tests", "Widget tests", "Build Web", "Build Android APK", "baseline-checks"]) {
    assert.equal(
      config.requiredChecks.includes(guessedJob),
      false,
      `requiredChecks must not assume the target uses '${guessedJob}' as a status context`
    );
  }
  assert.equal(config.commands.lint, "make check");
  assert.equal(config.commands.preflight, "pnpm run preflight");

  const packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  assert.match(packageJson.scripts.preflight, /pnpm run check:flutter/);
  assert.equal(packageJson.scripts["check:flutter"], "make check && make test");

  const dependabot = readFileSync(join(target, ".github/dependabot.yml"), "utf8");
  assert.match(dependabot, /package-ecosystem: "github-actions"/);
  assert.match(dependabot, /package-ecosystem: "pub"/);
  assert.doesNotMatch(dependabot, /package-ecosystem: "npm"/);

  for (const docPath of [
    "AGENTS.md",
    "README.md",
    "docs_project/project/devops/ai-pr-workflow.md"
  ]) {
    const content = readFileSync(join(target, docPath), "utf8");
    assert.doesNotMatch(
      content,
      /^- ?`baseline-checks`/m,
      `${docPath} must not list 'baseline-checks' as a hard-coded required check for flutter-app`
    );
    assert.match(
      content,
      /\.unicorn-hub\/config\.json/,
      `${docPath} should point readers at .unicorn-hub/config.json for the active requiredChecks list`
    );
  }
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
  assert.match(
    String(packageJson.packageManager || ""),
    /^pnpm@/,
    "packageManager must be filled from template defaults so baseline check passes"
  );
  assert.ok(packageJson.engines?.node, "engines.node must be filled from template defaults");

  const baselineOutput = run(["scripts/check-repo-baseline.mjs", "--target", target]);
  assert.match(
    baselineOutput,
    /Repository baseline check passed/,
    "baseline must pass against a target whose package.json was minimal pre-bootstrap"
  );
});

test("bootstrap into pre-existing package.json preserves user-defined packageManager", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-flutter-user-pkg-mgr-"));
  writeFileSync(join(target, "pubspec.yaml"), "name: synthetic_flutter_app\n");
  writeFileSync(
    join(target, "package.json"),
    `${JSON.stringify(
      {
        name: "existing-app",
        private: true,
        packageManager: "pnpm@9.0.0",
        scripts: { custom: "echo custom" }
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
    "User Pkg Mgr Flutter"
  ]);

  const packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  assert.equal(
    packageJson.packageManager,
    "pnpm@9.0.0",
    "user-defined packageManager must outrank template defaults"
  );
});

test("dependabot renderer preserves explicit zero values", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-dependabot-zero-"));
  writeFileSync(join(target, "pubspec.yaml"), "name: synthetic_flutter_app\n");

  const customProfile = {
    id: "flutter-app-zero-test",
    description: "Synthetic Flutter profile that exercises explicit zero defaults.",
    docsDir: "docs_project",
    specsDir: "specs",
    productPaths: ["lib/"],
    excludeTemplates: [".github/workflows/ci.yml"],
    requiredChecks: ["guard", "AI Review"],
    dependabotUpdates: [
      {
        packageEcosystem: "pub",
        directory: "/",
        openPullRequestsLimit: 0,
        cooldown: {
          defaultDays: 0,
          semverMajorDays: 0,
          semverMinorDays: 0,
          semverPatchDays: 0
        }
      }
    ],
    deploy: { type: "mobile-app-store" }
  };

  const profilesDir = mkdtempSync(join(tmpdir(), "unicorn-profiles-"));
  mkdirSync(join(profilesDir, "profiles"), { recursive: true });
  writeFileSync(
    join(profilesDir, "profiles", "flutter-app-zero-test.json"),
    `${JSON.stringify(customProfile, null, 2)}\n`
  );
  for (const dir of ["templates", "scripts"]) {
    mkdirSync(join(profilesDir, dir), { recursive: true });
  }
  for (const file of ["templates", "scripts"]) {
    execFileSync("cp", ["-R", join(root, file) + "/.", join(profilesDir, file)], { stdio: "ignore" });
  }

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    profilesDir,
    "--target",
    target,
    "--profile",
    "flutter-app-zero-test",
    "--project-name",
    "Zero Defaults Flutter"
  ]);

  const dependabot = readFileSync(join(target, ".github/dependabot.yml"), "utf8");
  assert.match(
    dependabot,
    /open-pull-requests-limit: 0/,
    "explicit openPullRequestsLimit: 0 must survive rendering"
  );
  assert.match(dependabot, /default-days: 0/);
  assert.match(dependabot, /semver-major-days: 0/);
  assert.match(dependabot, /semver-minor-days: 0/);
  assert.match(dependabot, /semver-patch-days: 0/);
});

test("baseline check ignores excludeTemplates entries outside the profile-safe allowlist", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-baseline-allowlist-"));
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
    "Allowlist Probe Flutter"
  ]);

  const configPath = join(target, ".unicorn-hub/config.json");
  const tampered = JSON.parse(readFileSync(configPath, "utf8"));
  tampered.excludeTemplates = [".github/workflows/ci.yml", "AGENTS.md"];
  writeFileSync(configPath, `${JSON.stringify(tampered, null, 2)}\n`);

  execFileSync("rm", [join(target, "AGENTS.md")]);

  let failed = false;
  let stderr = "";
  try {
    execFileSync("node", ["scripts/check-repo-baseline.mjs", "--target", target], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    failed = true;
    stderr = String(error.stderr || "");
  }
  assert.equal(failed, true, "baseline must reject AGENTS.md exclusion via config tampering");
  assert.match(stderr, /AGENTS\.md/, "baseline error should name the missing required path");
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
