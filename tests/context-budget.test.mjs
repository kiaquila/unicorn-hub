import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(".");

function run(args) {
  return execFileSync("node", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runFailure(args) {
  try {
    run(args);
    assert.fail("expected command to fail");
  } catch (error) {
    return `${error.stdout || ""}${error.stderr || ""}`;
  }
}

function git(target, args) {
  return execFileSync("git", args, {
    cwd: target,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function commitAll(target, message) {
  git(target, ["add", "."]);
  git(target, ["commit", "-m", message]);
}

function writeConfig(target, extra = {}) {
  mkdirSync(join(target, ".unicorn-hub"), { recursive: true });
  writeFileSync(
    join(target, ".unicorn-hub/config.json"),
    `${JSON.stringify(
      {
        docsDir: "docs_project",
        specsDir: "specs",
        productPaths: ["src/"],
        requiredChecks: ["baseline-checks", "guard", "AI Review"],
        ...extra
      },
      null,
      2
    )}\n`
  );
}

function writeCompactAgentFiles(target) {
  writeFileSync(join(target, "AGENTS.md"), "# AGENTS\n\nHard rules only.\n");
  writeFileSync(join(target, "CLAUDE.md"), "# CLAUDE\n\nRead AGENTS.md first.\n");
}

function writeSubstantiveFeature(target, featureId = "001-real") {
  const featureDir = join(target, "specs", featureId);
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(
    join(featureDir, "spec.md"),
    `# Spec: Real Feature

## Goal

Provide enough context for an agent to implement the synthetic target safely.

## Acceptance Criteria

- AC-001: The feature records a concrete outcome and user-visible behavior.
- AC-002: The feature describes how maintainers can verify the expected result.
`
  );
  writeFileSync(
    join(featureDir, "plan.md"),
    `# Plan: Real Feature

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Run the synthetic unit test and inspect the changed output. |
| AC-002 | Run local preflight and confirm the context-budget gate passes. |
`
  );
}

function writePlaceholderFeature(target, featureId = "001-placeholder") {
  const featureDir = join(target, "specs", featureId);
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(
    join(featureDir, "spec.md"),
    `# Spec: Placeholder

## Goal

[Add the goal.]

## Acceptance Criteria

[Add acceptance criteria.]
`
  );
  writeFileSync(
    join(featureDir, "plan.md"),
    `# Plan: Placeholder

## Verification

[Add verification evidence.]
`
  );
}

function writeTemplateVerificationFeature(target, featureId = "001-template-verification") {
  const featureDir = join(target, "specs", featureId);
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(
    join(featureDir, "spec.md"),
    `# Spec: Real Feature

## Goal

Provide enough context for an agent to implement the synthetic target safely.

## Acceptance Criteria

- AC-001: The feature records a concrete outcome and user-visible behavior.
- AC-002: The feature describes how maintainers can verify the expected result.
`
  );
  writeFileSync(
    join(featureDir, "plan.md"),
    `# Plan: Real Feature

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | \`[Command, test, screenshot, diff, or manual check]\` |

Negative scenario evidence:

- \`[Command, test, screenshot, diff, or manual check]\`
`
  );
}

test("context budget passes compact blueprint templates", () => {
  const output = run(["scripts/check-context-budget.mjs", "--feature", "010-light-agent-context", "--worktree"]);
  assert.match(output, /Context budget check passed/);
});

test("context budget report includes always-on counts and changed feature folders", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-context-report-"));
  writeConfig(target);
  writeCompactAgentFiles(target);
  writeSubstantiveFeature(target);

  const output = run([
    "scripts/check-context-budget.mjs",
    "--target",
    target,
    "--feature",
    "001-real",
    "--report"
  ]);

  assert.match(output, /Agent readiness report/);
  assert.match(output, /AGENTS\.md: 3 lines/);
  assert.match(output, /changed feature folders: 001-real/);
  assert.match(output, /Context budget check passed/);
});

test("context budget rejects oversized always-on files", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-context-oversized-"));
  writeConfig(target);
  writeFileSync(join(target, "AGENTS.md"), `${Array.from({ length: 61 }, (_, index) => `Line ${index + 1}`).join("\n")}\n`);
  writeFileSync(join(target, "CLAUDE.md"), "# CLAUDE\n");

  const output = runFailure(["scripts/check-context-budget.mjs", "--target", target]);
  assert.match(output, /Context budget check failed/);
  assert.match(output, /AGENTS\.md has 61 lines/);
});

test("context budget rejects placeholder-only feature memory", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-context-placeholder-"));
  writeConfig(target);
  writeCompactAgentFiles(target);
  writePlaceholderFeature(target);

  const output = runFailure([
    "scripts/check-context-budget.mjs",
    "--target",
    target,
    "--feature",
    "001-placeholder"
  ]);
  assert.match(output, /placeholder-only or too-thin ## Goal/);
  assert.match(output, /placeholder-only or too-thin ## Acceptance Criteria/);
  assert.match(output, /placeholder-only or too-thin ## Verification/);
});

test("context budget rejects template-only verification evidence", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-context-template-verification-"));
  writeConfig(target);
  writeCompactAgentFiles(target);
  writeTemplateVerificationFeature(target);

  const output = runFailure([
    "scripts/check-context-budget.mjs",
    "--target",
    target,
    "--feature",
    "001-template-verification"
  ]);
  assert.doesNotMatch(output, /placeholder-only or too-thin ## Goal/);
  assert.doesNotMatch(output, /placeholder-only or too-thin ## Acceptance Criteria/);
  assert.match(output, /placeholder-only or too-thin ## Verification/);
});

test("context budget rejects staged placeholder specs in worktree mode", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-context-staged-placeholder-"));
  git(target, ["init"]);
  git(target, ["config", "user.email", "test@example.com"]);
  git(target, ["config", "user.name", "Test User"]);
  writeConfig(target);
  writeCompactAgentFiles(target);
  commitAll(target, "base");

  writePlaceholderFeature(target);
  git(target, ["add", "specs/001-placeholder/spec.md", "specs/001-placeholder/plan.md"]);

  const output = runFailure([
    "scripts/check-context-budget.mjs",
    "--target",
    target,
    "--worktree"
  ]);
  assert.match(output, /placeholder-only or too-thin ## Goal/);
  assert.match(output, /placeholder-only or too-thin ## Acceptance Criteria/);
  assert.match(output, /placeholder-only or too-thin ## Verification/);
});

test("context budget rejects placeholder specs committed in branch diff", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-context-committed-placeholder-"));
  git(target, ["init"]);
  git(target, ["config", "user.email", "test@example.com"]);
  git(target, ["config", "user.name", "Test User"]);
  writeConfig(target);
  writeCompactAgentFiles(target);
  commitAll(target, "base");

  writePlaceholderFeature(target);
  commitAll(target, "add placeholder spec");

  const output = runFailure([
    "scripts/check-context-budget.mjs",
    "--target",
    target,
    "HEAD~1",
    "HEAD"
  ]);
  assert.match(output, /placeholder-only or too-thin ## Goal/);
  assert.match(output, /placeholder-only or too-thin ## Acceptance Criteria/);
  assert.match(output, /placeholder-only or too-thin ## Verification/);
});

test("context budget fails when default diff refs cannot be resolved", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-context-missing-ref-"));
  git(target, ["init"]);
  git(target, ["config", "user.email", "test@example.com"]);
  git(target, ["config", "user.name", "Test User"]);
  writeConfig(target);
  writeCompactAgentFiles(target);
  commitAll(target, "base");

  writePlaceholderFeature(target);
  commitAll(target, "add placeholder spec");

  const output = runFailure([
    "scripts/check-context-budget.mjs",
    "--target",
    target
  ]);
  assert.match(output, /Unable to inspect committed changes between origin\/main and HEAD/);
});

test("context budget local-preflight mode validates committed specs without remote refs", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-context-local-preflight-"));
  git(target, ["init"]);
  git(target, ["config", "user.email", "test@example.com"]);
  git(target, ["config", "user.name", "Test User"]);
  writeConfig(target);
  writeCompactAgentFiles(target);
  commitAll(target, "base");

  writePlaceholderFeature(target);
  commitAll(target, "add placeholder spec");

  const output = runFailure([
    "scripts/check-context-budget.mjs",
    "--target",
    target,
    "--local-preflight"
  ]);
  assert.match(output, /placeholder-only or too-thin ## Goal/);
  assert.doesNotMatch(output, /Unable to inspect committed changes/);
});

test("context budget uses configured default base branch for committed diffs", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-context-default-base-"));
  git(target, ["init"]);
  git(target, ["config", "user.email", "test@example.com"]);
  git(target, ["config", "user.name", "Test User"]);
  writeConfig(target, { defaultBaseBranch: "trunk" });
  writeCompactAgentFiles(target);
  commitAll(target, "base");
  git(target, ["update-ref", "refs/remotes/origin/trunk", "HEAD"]);

  writePlaceholderFeature(target);
  commitAll(target, "add placeholder spec");

  const output = runFailure([
    "scripts/check-context-budget.mjs",
    "--target",
    target
  ]);
  assert.match(output, /placeholder-only or too-thin ## Goal/);
  assert.doesNotMatch(output, /Unable to inspect committed changes/);
});
