import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(".");

function countLines(text) {
  return text.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

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

  const nextStepsBlock = output.split("\nNext:\n")[1] ?? "";
  assert.notEqual(nextStepsBlock, "", "bootstrap output must contain a 'Next:' block");
  assert.match(nextStepsBlock, /^1\. Review placeholders.*AGENTS\.md.*CLAUDE\.md.*docs_project\/.*\.unicorn-hub\/config\.json/m);
  assert.match(nextStepsBlock, /^2\. .*CREATE-DOCS\.md.*docs-minimum\.md/m);
  assert.match(nextStepsBlock, /^3\. Create the first specs\/<feature-id>/m);
  assert.match(nextStepsBlock, /^4\. Run the project preflight.*merge the installed workflows/m);
  assert.match(nextStepsBlock, /^5\. .*apply-security-settings\.mjs --dry-run/m);
  assert.match(nextStepsBlock, /^6\. .*apply-security-settings\.mjs --apply/m);

  for (const path of [
    "AGENTS.md",
    "CLAUDE.md",
    "CREATE-DOCS.md",
    "docs-minimum.md",
    "docs-full-interview.md",
    "docs_project/README.md",
    ".specify/memory/constitution.md",
    ".specify/templates/spec-template.md",
    ".github/pull_request_template.md",
    ".github/workflows/pr-guard.yml",
    ".github/workflows/ai-review.yml",
    ".github/workflows/ai-review-rerun.yml",
    "scripts/ai-command-policy.mjs",
    "scripts/ai-review-rerun.mjs",
    "scripts/check-dependency-policy.mjs",
    "scripts/check-context-budget.mjs",
    "scripts/check-feature-memory.mjs",
    "scripts/publish-branch.mjs",
    "scripts/github-api.mjs",
    "scripts/apply-security-settings.mjs",
    "scripts/apply-branch-protection.mjs",
    ".github/workflows/osv-scan.yml",
    ".unicorn-hub/config.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml"
  ]) {
    assert.equal(existsSync(join(target, path)), true, `${path} should exist`);
  }

  const agents = readFileSync(join(target, "AGENTS.md"), "utf8");
  assert.match(agents, /Synthetic App/);
  assert.doesNotMatch(agents, /<PROJECT_NAME>/);
  assert.match(agents, /CREATE-DOCS\.md/);
  assert.match(agents, /docs-minimum\.md/);
  assert.match(agents, /Task-Scoped Reading/);
  assert.ok(countLines(agents) <= 60, "installed AGENTS.md should stay compact");
  assert.doesNotMatch(agents, /Supported review backends/);
  assert.doesNotMatch(agents, /## Roles/);

  const readme = readFileSync(join(target, "README.md"), "utf8");
  assert.match(readme, /First Setup After Bootstrap/);
  assert.match(readme, /CREATE-DOCS\.md/);
  assert.match(readme, /docs-minimum\.md/);

  const claude = readFileSync(join(target, "CLAUDE.md"), "utf8");
  assert.match(claude, /## First Setup/);
  assert.match(claude, /CREATE-DOCS\.md/);
  assert.match(claude, /docs-minimum\.md/);
  assert.ok(countLines(claude) <= 60, "installed CLAUDE.md should stay compact");
  assert.doesNotMatch(claude, /Supported review backends/);

  const createDocs = readFileSync(join(target, "CREATE-DOCS.md"), "utf8");
  assert.match(createDocs, /## Default Path: Minimum Docs/);
  assert.match(createDocs, /docs-minimum\.md/);
  assert.match(createDocs, /docs-full-interview\.md/);
  assert.match(createDocs, /Do not run the full interview by default/);

  const docsReadme = readFileSync(join(target, "docs_project/README.md"), "utf8");
  assert.match(docsReadme, /## First Setup/);
  assert.match(docsReadme, /docs-minimum\.md/);
  assert.match(docsReadme, /Task-Scoped Reading/);
  assert.match(docsReadme, /specs\/<feature-id>/);

  const config = JSON.parse(readFileSync(join(target, ".unicorn-hub/config.json"), "utf8"));
  assert.equal(config.profile, "generic");
  assert.equal(config.defaultBaseBranch, "main");
  assert.equal(config.dependencyPolicy.node.minimumReleaseAgeMinutes, 10080);
  assert.deepEqual(config.dependencyPolicy.node.typosquatExceptions, []);
  assert.equal(config.dependencyPolicy.python.enabled, false);
  assert.deepEqual(config.requiredChecks, ["baseline-checks", "guard", "osv-scan", "AI Review"]);

  const packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["check:context"], "node scripts/check-context-budget.mjs");
  assert.equal(packageJson.scripts["check:dependencies"], "node scripts/check-dependency-policy.mjs");
  assert.match(packageJson.scripts.preflight, /pnpm run check:context -- --local-preflight && pnpm run check:context -- --worktree/);
  assert.equal(
    readFileSync(join(target, "scripts/publish-branch.mjs"), "utf8"),
    readFileSync(join(root, "scripts/publish-branch.mjs"), "utf8"),
    "bootstrap must preserve the canonical PR publication behavior"
  );

  const prGuard = readFileSync(join(target, ".github/workflows/pr-guard.yml"), "utf8");
  assert.match(prGuard, /Validate context budget/);
  assert.match(prGuard, /check-context-budget\.mjs --target "\$GITHUB_WORKSPACE" "\$BASE_REF" "\$HEAD_REF"/);
  assert.match(prGuard, /check-dependency-policy\.mjs --sync-python/);

  const workspacePolicy = readFileSync(join(target, "pnpm-workspace.yaml"), "utf8");
  assert.match(workspacePolicy, /^minimumReleaseAge: 10080$/m);
  assert.match(workspacePolicy, /^blockExoticSubdeps: true$/m);
  assert.match(workspacePolicy, /^trustPolicy: no-downgrade$/m);
  assert.match(workspacePolicy, /^strictDepBuilds: true$/m);
  assert.match(workspacePolicy, /^allowBuilds: \{\}$/m);

  const specTemplate = readFileSync(join(target, ".specify/templates/spec-template.md"), "utf8");
  assert.match(specTemplate, /## Goal/);
  assert.match(specTemplate, /## Negative Scenarios/);

  const prTemplate = readFileSync(join(target, ".github/pull_request_template.md"), "utf8");
  assert.match(prTemplate, /SENAR Done Gate/);
});

test("bootstrap renders workflow push filters for the discovered default branch", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-bootstrap-trunk-"));
  execFileSync("git", ["init", "--initial-branch=trunk"], { cwd: target, stdio: "ignore" });
  execFileSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"],
    { cwd: target, stdio: "ignore" }
  );

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Synthetic Trunk"
  ]);

  const config = JSON.parse(readFileSync(join(target, ".unicorn-hub/config.json"), "utf8"));
  const ci = readFileSync(join(target, ".github/workflows/ci.yml"), "utf8");
  const osv = readFileSync(join(target, ".github/workflows/osv-scan.yml"), "utf8");
  assert.equal(config.defaultBaseBranch, "trunk");
  assert.match(ci, /push:\n    branches:\n      - "trunk"/);
  assert.match(osv, /push:\n    branches: \["trunk"\]/);
  assert.doesNotMatch(ci, /<DEFAULT_BRANCH>/);
  assert.doesNotMatch(osv, /<DEFAULT_BRANCH>/);
});

test("bootstrap --dry-run announces a dry run instead of next steps", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-bootstrap-dry-"));

  const output = run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Synthetic Dry",
    "--dry-run"
  ]);

  assert.match(output, /Dry run for Unicorn Hub blueprint profile 'generic'/);
  assert.match(output, /Re-run without --dry-run to apply\./);
  assert.doesNotMatch(output, /\nNext:\n/);
  assert.equal(existsSync(join(target, "AGENTS.md")), false, "dry run must not write files");
});

test("bootstrap preserves dependency policy consumer files unless --force is used", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-dependency-collision-"));
  mkdirSync(join(target, "scripts"), { recursive: true });
  const consumerScript = "console.log('consumer dependency policy');\n";
  const consumerWorkspace = "packages:\n  - consumer-package\n";
  writeFileSync(join(target, "scripts/check-dependency-policy.mjs"), consumerScript);
  writeFileSync(join(target, "pnpm-workspace.yaml"), consumerWorkspace);

  const first = run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Synthetic Collision"
  ]);
  assert.match(first, /^skip\s+scripts\/check-dependency-policy\.mjs$/m);
  assert.match(first, /^skip\s+pnpm-workspace\.yaml$/m);
  assert.equal(readFileSync(join(target, "scripts/check-dependency-policy.mjs"), "utf8"), consumerScript);
  assert.equal(readFileSync(join(target, "pnpm-workspace.yaml"), "utf8"), consumerWorkspace);

  const forced = run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Synthetic Collision",
    "--force"
  ]);
  assert.match(forced, /^overwrite\s+scripts\/check-dependency-policy\.mjs$/m);
  assert.match(forced, /^overwrite\s+pnpm-workspace\.yaml$/m);
  assert.equal(
    readFileSync(join(target, "scripts/check-dependency-policy.mjs"), "utf8"),
    readFileSync(join(root, "scripts/check-dependency-policy.mjs"), "utf8")
  );
  assert.match(readFileSync(join(target, "pnpm-workspace.yaml"), "utf8"), /strictDepBuilds: true/);
});

test("Python profiles receive locked dependency contracts without affecting generic", () => {
  for (const profile of ["python-service", "telegram-bot"]) {
    const target = mkdtempSync(join(tmpdir(), `unicorn-${profile}-policy-`));
    run([
      "scripts/bootstrap-repo.mjs",
      "--source",
      root,
      "--target",
      target,
      "--profile",
      profile,
      "--project-name",
      `Synthetic ${profile}`
    ]);
    const config = JSON.parse(readFileSync(join(target, ".unicorn-hub/config.json"), "utf8"));
    assert.equal(config.dependencyPolicy.python.enabled, true, profile);
    assert.equal(config.commands.install, "uv lock --check && uv sync --locked", profile);
    assert.doesNotMatch(config.commands.install, /pip install -r requirements.*\.txt/, profile);
  }
});

test("bootstrap idempotent re-run reports nothing new to review", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-bootstrap-rerun-"));

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Synthetic Rerun"
  ]);

  const output = run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Synthetic Rerun"
  ]);

  const nextStepsBlock = output.split("\nNext:\n")[1] ?? "";
  assert.match(nextStepsBlock, /^1\. No new files were written\. Existing/m);
  assert.match(nextStepsBlock, /not compared to the blueprint/);
  assert.match(nextStepsBlock, /--force/);
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
    ["guard", "osv-scan", "AI Review"],
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
  assert.equal(packageJson.scripts["check:context"], "node scripts/check-context-budget.mjs");
  assert.match(packageJson.scripts.preflight, /pnpm run check:flutter/);
  assert.match(packageJson.scripts.preflight, /pnpm run check:context -- --local-preflight && pnpm run check:context -- --worktree/);
  assert.equal(packageJson.scripts["check:flutter"], "make check && make test");

  const dependabot = readFileSync(join(target, ".github/dependabot.yml"), "utf8");
  assert.match(dependabot, /package-ecosystem: "github-actions"/);
  assert.match(dependabot, /package-ecosystem: "pub"/);
  assert.doesNotMatch(dependabot, /package-ecosystem: "npm"/);

  const [githubActionsDependabot, pubDependabot] = dependabot.split('  - package-ecosystem: "pub"');
  assert.match(githubActionsDependabot, /cooldown:\n      default-days: 7/);
  assert.doesNotMatch(githubActionsDependabot, /semver-\w+-days/);
  assert.match(githubActionsDependabot, /groups:\n      minor-and-patch:\n        update-types:\n          - "minor"\n          - "patch"/);
  assert.match(pubDependabot, /semver-major-days: 14/);
  assert.match(pubDependabot, /groups:\n      minor-and-patch:\n        update-types:\n          - "minor"\n          - "patch"/);

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
  assert.equal(existsSync(join(target, ".github/workflows/ai-review-rerun.yml")), true);
  assert.equal(existsSync(join(target, ".github/workflows/osv-scan.yml")), true);

  const config = JSON.parse(readFileSync(join(target, ".unicorn-hub/config.json"), "utf8"));
  assert.equal(config.requiredChecks.includes("baseline-checks"), false);
  assert.equal(config.requiredChecks.includes("osv-scan"), true);
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
  assert.match(packageJson.scripts.preflight, /pnpm run check:context -- --local-preflight && pnpm run check:context -- --worktree/);
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
  assert.equal(
    packageJson.scripts["check:context"],
    "node scripts/check-context-budget.mjs",
    "baseline check:context script must be filled in for the merged preflight"
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

  assert.throws(
    () => run(["scripts/check-repo-baseline.mjs", "--target", target]),
    /Command failed/,
    "preserved pnpm versions older than the security-policy minimum must fail baseline until explicitly upgraded"
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

test("Dependabot renderer keeps ecosystems separate with minor-and-patch groups", () => {
  const cases = [
    ["generic", ["github-actions", "npm"]],
    ["next-app", ["github-actions", "npm"]],
    ["flutter-app", ["github-actions", "pub"]],
    ["python-service", ["github-actions", "pip"]]
  ];

  for (const [profile, expectedEcosystems] of cases) {
    const target = mkdtempSync(join(tmpdir(), `unicorn-dependabot-${profile}-`));
    run([
      "scripts/bootstrap-repo.mjs",
      "--source",
      root,
      "--target",
      target,
      "--profile",
      profile,
      "--project-name",
      `Synthetic ${profile}`
    ]);

    const dependabot = readFileSync(join(target, ".github/dependabot.yml"), "utf8");
    const blocks = dependabot.split(/(?=  - package-ecosystem: )/).slice(1);
    const ecosystems = blocks.map((block) => block.match(/package-ecosystem: "([^"]+)"/)?.[1]);
    assert.deepEqual(ecosystems, expectedEcosystems, profile);

    for (const block of blocks) {
      const ecosystem = block.match(/package-ecosystem: "([^"]+)"/)?.[1];
      const group = block.match(/    groups:\n([\s\S]*)$/)?.[1] || "";
      assert.match(group, /minor-and-patch:\n        update-types:\n          - "minor"\n          - "patch"/, ecosystem);
      assert.doesNotMatch(group, /"major"/, `${ecosystem} major updates must stay separate`);
      assert.match(block, /schedule:\n      interval: "weekly"/, ecosystem);
      assert.match(block, /cooldown:\n      default-days: 7/, ecosystem);
      if (ecosystem === "github-actions") {
        assert.doesNotMatch(block, /semver-\w+-days/, "github-actions does not support semver cooldown fields");
      } else {
        assert.match(block, /semver-major-days: 14/);
        assert.match(block, /semver-minor-days: 7/);
        assert.match(block, /semver-patch-days: 3/);
      }
    }
  }
});

test("profile excluding OSV workflow also excludes the osv-scan required check", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-no-osv-target-"));
  const source = mkdtempSync(join(tmpdir(), "unicorn-no-osv-source-"));
  mkdirSync(join(source, "profiles"), { recursive: true });
  writeFileSync(
    join(source, "profiles", "no-osv.json"),
    `${JSON.stringify({
      id: "no-osv",
      description: "Synthetic profile without OSV.",
      docsDir: "docs_project",
      specsDir: "specs",
      productPaths: ["src/"],
      excludeTemplates: [".github/workflows/osv-scan.yml"],
      requiredChecks: ["baseline-checks", "guard", "osv-scan", "AI Review"],
      dependabotUpdates: [{ packageEcosystem: "github-actions", directory: "/" }],
      deploy: { type: "synthetic" }
    }, null, 2)}\n`
  );
  for (const directory of ["templates", "scripts"]) {
    mkdirSync(join(source, directory), { recursive: true });
    execFileSync("cp", ["-R", join(root, directory) + "/.", join(source, directory)], { stdio: "ignore" });
  }

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    source,
    "--target",
    target,
    "--profile",
    "no-osv",
    "--project-name",
    "Synthetic No OSV"
  ]);

  const config = JSON.parse(readFileSync(join(target, ".unicorn-hub/config.json"), "utf8"));
  assert.equal(existsSync(join(target, ".github/workflows/osv-scan.yml")), false);
  assert.equal(config.requiredChecks.includes("osv-scan"), false);
  assert.match(run(["scripts/check-repo-baseline.mjs", "--target", target]), /Repository baseline check passed/);
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

test("bootstrap installs a .gitattributes that vendors the governance envelope", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-gitattributes-"));

  run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Synthetic Linguist"
  ]);

  const gitattributes = readFileSync(join(target, ".gitattributes"), "utf8");
  assert.match(gitattributes, /# >>> unicorn-hub governance \(managed block/);
  assert.doesNotMatch(gitattributes, /^scripts\/\*\.mjs\s+linguist-vendored$/m);
  assert.match(gitattributes, /^scripts\/ai-review-gate\.mjs\s+linguist-vendored$/m);
  assert.match(gitattributes, /^scripts\/shared\.mjs\s+linguist-vendored$/m);
  assert.match(gitattributes, /^scripts\/apply-branch-protection\.mjs\s+linguist-vendored$/m);
  assert.match(gitattributes, /^scripts\/apply-security-settings\.mjs\s+linguist-vendored$/m);
  assert.match(gitattributes, /^scripts\/github-api\.mjs\s+linguist-vendored$/m);
  assert.match(gitattributes, /^\.unicorn-hub\/\*\*\s+linguist-vendored$/m);
  assert.match(gitattributes, /^\.specify\/\*\*\s+linguist-vendored$/m);

  // Linguist honours .gitattributes via git check-attr; prove the envelope is
  // vendored while product code keeps its language stats.
  execFileSync("git", ["init", "-q"], { cwd: target });
  writeFileSync(join(target, "scripts/build.mjs"), "console.log('consumer product script');\n");
  const checkAttr = (path) =>
    execFileSync("git", ["check-attr", "linguist-vendored", "--", path], {
      cwd: target,
      encoding: "utf8"
    }).trim();

  assert.match(checkAttr("scripts/ai-review-gate.mjs"), /linguist-vendored: set$/);
  assert.match(checkAttr(".unicorn-hub/config.json"), /linguist-vendored: set$/);
  assert.match(checkAttr(".specify/memory/constitution.md"), /linguist-vendored: set$/);
  // Product code must NOT be vendored.
  assert.match(checkAttr("scripts/build.mjs"), /linguist-vendored: unspecified$/);
  assert.match(checkAttr("src/main.py"), /linguist-vendored: unspecified$/);
  assert.match(checkAttr("app/index.ts"), /linguist-vendored: unspecified$/);
});

test("bootstrap does not vendor pre-existing consumer script collisions", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-gitattributes-collision-"));
  mkdirSync(join(target, "scripts"), { recursive: true });
  writeFileSync(join(target, "scripts/shared.mjs"), "console.log('consumer-owned script');\n");

  const output = run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Collision Linguist"
  ]);
  assert.match(output, /^skip\s+scripts\/shared\.mjs$/m);

  const gitattributes = readFileSync(join(target, ".gitattributes"), "utf8");
  assert.doesNotMatch(gitattributes, /^scripts\/shared\.mjs\s+linguist-vendored$/m);
  assert.match(gitattributes, /^scripts\/ai-review-gate\.mjs\s+linguist-vendored$/m);

  execFileSync("git", ["init", "-q"], { cwd: target });
  const checkAttr = (path) =>
    execFileSync("git", ["check-attr", "linguist-vendored", "--", path], {
      cwd: target,
      encoding: "utf8"
    }).trim();

  assert.match(checkAttr("scripts/shared.mjs"), /linguist-vendored: unspecified$/);
  assert.match(checkAttr("scripts/ai-review-gate.mjs"), /linguist-vendored: set$/);
});

test("bootstrap vendors skipped scripts that already match the managed blueprint", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-gitattributes-existing-managed-"));
  mkdirSync(join(target, "scripts"), { recursive: true });
  writeFileSync(
    join(target, "scripts/ai-review-gate.mjs"),
    readFileSync(join(root, "scripts/ai-review-gate.mjs"), "utf8")
  );

  const output = run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Existing Managed Linguist"
  ]);
  assert.match(output, /^skip\s+scripts\/ai-review-gate\.mjs$/m);

  const gitattributes = readFileSync(join(target, ".gitattributes"), "utf8");
  assert.match(gitattributes, /^scripts\/ai-review-gate\.mjs\s+linguist-vendored$/m);

  execFileSync("git", ["init", "-q"], { cwd: target });
  const checkAttr = execFileSync("git", [
    "check-attr",
    "linguist-vendored",
    "--",
    "scripts/ai-review-gate.mjs"
  ], {
    cwd: target,
    encoding: "utf8"
  }).trim();
  assert.match(checkAttr, /linguist-vendored: set$/);
});

test("bootstrap merges into a pre-existing consumer .gitattributes without clobbering it", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-gitattributes-merge-"));
  const consumerRules = "*.py text eol=lf\nvendor/** linguist-vendored\n";
  writeFileSync(join(target, ".gitattributes"), consumerRules);

  const firstRun = run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Merge Linguist"
  ]);
  assert.match(firstRun, /^merge\s+\.gitattributes$/m);

  const merged = readFileSync(join(target, ".gitattributes"), "utf8");
  // Consumer rules survive verbatim.
  assert.match(merged, /\*\.py text eol=lf/);
  assert.match(merged, /vendor\/\*\* linguist-vendored/);
  // Governance block is appended after them.
  assert.match(merged, /# >>> unicorn-hub governance \(managed block/);
  assert.ok(
    merged.indexOf("vendor/** linguist-vendored") < merged.indexOf("scripts/ai-command-policy.mjs"),
    "consumer rules must remain ahead of the appended managed block"
  );

  // Re-run is idempotent: the managed marker is detected, nothing re-appended.
  const secondRun = run([
    "scripts/bootstrap-repo.mjs",
    "--source",
    root,
    "--target",
    target,
    "--profile",
    "generic",
    "--project-name",
    "Merge Linguist"
  ]);
  assert.match(secondRun, /^skip\s+\.gitattributes$/m);
  const reMerged = readFileSync(join(target, ".gitattributes"), "utf8");
  assert.equal(reMerged, merged, "idempotent re-run must not change .gitattributes");
  assert.equal(
    reMerged.match(/scripts\/ai-command-policy\.mjs/g).length,
    1,
    "managed block must not be duplicated on re-run"
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
