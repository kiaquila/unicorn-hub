import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(".");

test("root workflows stay generated from templates", () => {
  const output = execFileSync("node", ["scripts/sync-workflows.mjs", "--check"], {
    cwd: root,
    encoding: "utf8"
  });

  assert.match(output, /Root workflows match templates/);
});

test("root Dependabot configuration stays in sync with its template", () => {
  const rootConfig = readFileSync(join(root, ".github", "dependabot.yml"), "utf8");
  const templateConfig = readFileSync(join(root, "templates", ".github", "dependabot.yml"), "utf8");

  assert.equal(rootConfig, templateConfig);
});

test("CI requires a frozen pnpm lockfile without an unsafe fallback", () => {
  const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile/);
  assert.match(workflow, /version: 10\.34\.5/);
  assert.doesNotMatch(workflow, /--no-frozen-lockfile/);
  assert.doesNotMatch(workflow, /if \[ -f pnpm-lock\.yaml \]/);
  assert.ok(
    workflow.indexOf("pnpm run check:repo") < workflow.indexOf("pnpm install --frozen-lockfile"),
    "the pinned pnpm baseline must pass before dependency installation"
  );
});

test("dependency policy remains inside the existing PR Guard context", () => {
  const workflow = readFileSync(join(root, ".github", "workflows", "pr-guard.yml"), "utf8");
  assert.match(workflow, /jobs:\n  guard:\n    name: guard/);
  assert.match(workflow, /check-dependency-policy\.mjs --sync-python/);
  assert.match(workflow, /pnpm\/action-setup@ea17c68df8912ef543352723c149a84f56e3d413/);
  assert.match(workflow, /version: 10\.34\.5/);
  assert.match(workflow, /astral-sh\/setup-uv@1c37ad07a6a961277cf70c0d37d6f313000f5884/);
  assert.doesNotMatch(workflow, /^  dependency-policy:/m);
});

test("OSV workflow is blocking and retains all activation triggers", () => {
  const workflow = readFileSync(join(root, ".github", "workflows", "osv-scan.yml"), "utf8");
  assert.match(workflow, /on:\n  pull_request:/);
  assert.match(workflow, /push:\n    branches: \["main"\]/);
  assert.match(workflow, /schedule:\n    - cron: "0 6 \* \* 1"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /name: osv-scan/);
  assert.match(workflow, /--fail-on-vuln=true/);
  assert.match(workflow, /osv-scanner-action@b1d267aea5211fa648d9d442fa64b90dbdcbdd36/);
  assert.match(workflow, /osv-reporter-action@b1d267aea5211fa648d9d442fa64b90dbdcbdd36/);
});

test("installed workflow filter routes created/edited native evidence to the trusted runtime", () => {
  for (const prefix of ["", "templates/"]) {
    const workflow = readFileSync(join(root, prefix, ".github/workflows/ai-review-rerun.yml"), "utf8");
    assert.match(workflow, /pull_request_review:\n    types: \[submitted, edited, dismissed\]/);
    assert.match(workflow, /issue_comment:\n    types: \[created, edited, deleted\]/);
    assert.match(workflow, /run: node scripts\/ai-review-rerun.mjs/);
    assert.match(workflow, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /queue: max/, "pending command markers and evidence wakeups must not evict each other");
    assert.match(workflow, /pull_request_review_comment:\n    types: \[created, edited, deleted\]/);
    const expression = workflow.match(/    if: \|\n([\s\S]*?)    runs-on:/)[1];
    const route = new Function("github", "startsWith", "contains", `return (${expression});`);
    const destructiveEdit = { event_name: "issue_comment", event: { action: "edited", issue: { pull_request: {} }, comment: { body: "Review withdrawn", user: { type: "Bot" } } } };
    assert.equal(Boolean(route(destructiveEdit, (text, prefix) => text.startsWith(prefix), (text, part) => text.includes(part))), true);
    for (const action of ["submitted", "edited", "dismissed"]) {
      const github = { event_name: "pull_request_review", event: { action, review: { user: { type: "Bot" } } } };
      assert.equal(Boolean(route(github)), true);
    }
    for (const action of ["created", "edited", "deleted"]) {
      const inline = { event_name: "pull_request_review_comment", event: { action, pull_request: { number: 1 }, comment: { body: "P1 blocker", user: { type: "Bot" } } } };
      assert.equal(Boolean(route(inline)), true);
      inline.event.comment.user.type = "User";
      assert.equal(Boolean(route(inline)), false);
    }
    for (const action of ["created", "edited", "deleted"]) {
      for (const body of ["Codex Review: Didn't find any major issues.", "<!-- codex-review-receipt:v1 -->\n\nCodex Review: Didn't find any major issues.", "<!-- codex-pull-request-review-summary -->", "<!-- codex-review-state:v1 {} -->"]) {
        const github = { event_name: "issue_comment", event: { action, issue: { pull_request: {} }, comment: { body, user: { type: "Bot" } } } };
        assert.equal(Boolean(route(github, (text, prefix) => text.startsWith(prefix), (text, part) => text.includes(part))), true, body);
        github.event.comment.user.type = "User";
        assert.equal(Boolean(route(github, (text, prefix) => text.startsWith(prefix), (text, part) => text.includes(part))), false);
      }
    }
  }
  const policy = readFileSync(join(root, ".github/workflows/ai-command-policy.yml"), "utf8");
  assert.match(policy, /group: ai-review-wakeup-/);
  assert.match(policy, /cancel-in-progress: false/);
  assert.match(policy, /queue: max/);
});


test("deletion recording executes only in the default-branch controller with existing write scope", () => {
  const policy = readFileSync(join(root, ".github/workflows/ai-command-policy.yml"), "utf8");
  assert.match(policy, /workflow_run:\n    workflows: \[AI Review Rerun\]\n    types: \[requested\]/);
  const recorder = policy.slice(policy.indexOf("  record-review-withdrawal:"));
  assert.match(recorder, /if: github.event_name == 'workflow_run'/);
  assert.match(recorder, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  assert.match(recorder, /persist-credentials: false/);
  assert.match(recorder, /run: node scripts\/ai-review-rerun.mjs/);
  assert.doesNotMatch(recorder, /artifact|AI_REVIEW_GATE_PIN/);
  const router = readFileSync(join(root, ".github/workflows/ai-review-rerun.yml"), "utf8");
  assert.match(router, /run-name: AI review evidence:/);
  assert.match(router, /startsWith\(github.event.changes.body.from, '<!-- unicorn-hub:ai-review-withdrawal:'/);
  assert.doesNotMatch(router, /issues: write/);
  assert.match(readFileSync(join(root, ".github/workflows/ai-review.yml"), "utf8"), /timeout-minutes: 10/);
});


test("withdrawal metadata shares case-insensitive column-zero legacy grammar with runtime", () => {
  for (const prefix of ["", "templates/"]) {
    const workflow = readFileSync(join(root, prefix, ".github/workflows/ai-review-rerun.yml"), "utf8");
    const expressions = [...workflow.split("\n")[1].matchAll(/\$\{\{ (.*?) \}\}/g)].map((match) => match[1]);
    const withdrawal = new Function("github", "startsWith", "contains", `return (${expressions.at(-2)});`);
    const structured = new Function("github", "contains", `return (${expressions.at(-1)});`);
    const startsWith = (text = "", part) => text.toLowerCase().startsWith(part.toLowerCase());
    const contains = (text = "", part) => text.toLowerCase().includes(part.toLowerCase());
    for (const [body, expected] of [["Command response", false], ["Example: Codex Review: reference", false],
      ["Codex Review: Didn't find any major issues.", true], ["codex review: Didn't find any major issues.", true],
      [" Codex Review: Didn't find any major issues.", false], ["\nCodex Review: Didn't find any major issues.", false],
      ["<!-- codex-review-state:v1 {} -->", true], ["<!-- codex-review-receipt:v1 -->", true]]) {
      assert.equal(withdrawal({ event: { action: "deleted", comment: { body }, changes: { body: {} } } }, startsWith, contains), expected, body);
    }
    const github = { event: { action: "edited", comment: { body: "<!-- codex-review-receipt:v1 -->" },
      changes: { body: { from: "<!-- codex-review-state:v1 {} -->" } } } };
    assert.equal(structured(github, contains), true);
    github.event.comment.body = "<!-- codex-review-state:v1 {} -->";
    assert.equal(structured(github, contains), false, "normal summary updates must not fence their own completion");
    github.event.comment.body = "Ordinary reply";
    assert.equal(withdrawal(github, startsWith, contains), true);
  }
});
