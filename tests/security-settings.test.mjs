import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");

const fakeGhSource = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const statePath = process.env.FAKE_GH_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
function save() { writeFileSync(statePath, JSON.stringify(state)); }
function reply(status, value = null) {
  const names = { 200: "OK", 204: "No Content", 403: "Forbidden", 404: "Not Found", 422: "Unprocessable Entity", 500: "Server Error" };
  process.stdout.write("HTTP/1.1 " + status + " " + names[status] + "\\ncontent-type: application/json\\n\\n");
  if (value !== null) process.stdout.write(JSON.stringify(value));
  process.exit(status >= 400 ? 1 : 0);
}
if (args[0] === "repo" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ nameWithOwner: "synthetic/example", defaultBranchRef: { name: "main" } }));
  process.exit(0);
}
const method = args[args.indexOf("--method") + 1];
const path = args.find((item) => item.startsWith("/repos/"));
const body = args.includes("--input") ? JSON.parse(readFileSync(0, "utf8")) : null;
state.calls.push({ method, path, body });
save();
const repoPath = "/repos/synthetic/example";
if (method === "GET" && path === repoPath) {
  reply(200, { default_branch: "main", security_and_analysis: state.security });
}
if (path === repoPath + "/vulnerability-alerts") {
  if (method === "GET") reply(state.vulnerabilityAlerts ? 204 : 404, state.vulnerabilityAlerts ? null : { message: "Disabled" });
  if (state.failEndpoint === "vulnerability-alerts") reply(500, { message: "Synthetic API failure" });
  state.vulnerabilityAlerts = true; save(); reply(204);
}
if (path === repoPath + "/automated-security-fixes") {
  if (method === "GET") reply(state.automatedSecurityFixes ? 204 : 404, state.automatedSecurityFixes ? null : { message: "Disabled" });
  if (state.failEndpoint === "automated-security-fixes") reply(500, { message: "Synthetic API failure" });
  state.automatedSecurityFixes = true; save(); reply(204);
}
if (method === "PATCH" && path === repoPath) {
  const key = Object.keys(body.security_and_analysis)[0];
  if (state.unsupportedKey === key) reply(422, { message: "Feature is not available for this plan" });
  if (state.failKey === key) reply(403, { message: "Resource not accessible by personal access token" });
  if (state.ignoreKey !== key) state.security[key] = { status: "enabled" };
  save(); reply(200, { security_and_analysis: state.security });
}
if (method === "GET" && path === repoPath + "/commits/main") reply(200, { sha: "main-sha" });
if (method === "GET" && path.startsWith(repoPath + "/contents/.github/workflows/")) {
  if (state.missingWorkflow && path.includes(state.missingWorkflow)) reply(404, { message: "Not Found" });
  const requestUrl = new URL("https://synthetic.invalid" + path);
  const workflow = requestUrl.pathname.split("/").at(-1);
  const ref = requestUrl.searchParams.get("ref");
  const sha = ref === "recent-pr-sha" && state.stalePrWorkflowVersion
    ? "stale-" + workflow
    : "current-" + workflow;
  reply(200, { type: "file", sha });
}
if (method === "GET" && path.startsWith(repoPath + "/commits?path=")) {
  reply(200, [{ commit: { committer: { date: state.workflowCommitDate || "2026-01-01T00:00:00Z" } } }]);
}
if (method === "GET" && path.includes("/actions/workflows/") && path.endsWith("/runs?per_page=20")) {
  const createdAt = state.staleRuns ? "2000-01-01T00:00:00Z" : new Date().toISOString();
  const workflow = decodeURIComponent(path.match(/actions\\/workflows\\/([^/]+)\\/runs/)[1]);
  const definitions = {
    "ci.yml": { id: 1, check: "baseline-checks", defaultHead: true },
    "osv-scan.yml": { id: 2, check: "osv-scan", defaultHead: !state.osvOnlyOnPullRequest },
    "pr-guard.yml": { id: 3, check: "guard", defaultHead: false },
    "ai-review.yml": { id: 4, check: "AI Review", defaultHead: false },
    "flutter.yml": { id: 5, check: "flutter-pr", defaultHead: false }
  };
  const definition = definitions[workflow];
  const defaultHead = definition.defaultHead;
  reply(200, { workflow_runs: [{
    id: definition.id,
    event: defaultHead ? "push" : "pull_request",
    head_branch: defaultHead ? "main" : "feature",
    head_sha: defaultHead ? "main-sha" : "recent-pr-sha",
    created_at: createdAt,
    pull_requests: defaultHead || state.omitRunPullRequests ? [] : [{ base: { ref: "main" } }]
  }] });
}
if (method === "GET" && path.includes("/actions/runs/") && path.includes("/jobs?")) {
  const runId = Number(path.match(/actions\\/runs\\/(\\d+)/)[1]);
  const names = {
    1: ["baseline-checks"],
    2: ["osv-scan"],
    3: ["guard", ...(state.prCollisionCheck ? [state.prCollisionCheck] : [])],
    4: ["AI Review"],
    5: ["flutter-pr"]
  }[runId].filter((name) => state.checks.includes(name));
  reply(200, { jobs: names.map((name) => ({ name })) });
}
if (method === "GET" && path.includes("/status?")) reply(200, { statuses: [] });
if (method === "GET" && path.includes("/check-runs?")) {
  const page = Number(new URL("https://synthetic.invalid" + path).searchParams.get("page") || 1);
  if (state.customCheckOnSecondPage && page === 1) {
    reply(200, { check_runs: Array.from({ length: 100 }, (_, index) => ({ name: "filler-" + index })) });
  }
  reply(200, { check_runs: (state.customChecks || []).map((name) => ({ name })) });
}
if (method === "GET" && path.endsWith("/pulls")) {
  reply(200, [{ base: { ref: state.pullBase || "main" } }]);
}
if (method === "GET" && path === repoPath + "/branches/main/protection") {
  if (state.existingProtection) reply(200, state.existingProtection);
  reply(404, { message: "Not Found" });
}
if (method === "PUT" && path === repoPath + "/branches/main/protection") {
  const actorResponse = (value) => value ? {
    users: (value.users || []).map((login) => ({ login })),
    teams: (value.teams || []).map((slug) => ({ slug })),
    apps: (value.apps || []).map((slug) => ({ slug }))
  } : null;
  const checks = body.required_status_checks.checks
    .filter((item) => !state.dropVerifiedCheck || item.context !== state.dropVerifiedCheck);
  state.protectionApplied = true;
  state.protectionPayload = body;
  state.existingProtection = {
    required_status_checks: { strict: body.required_status_checks.strict, checks },
    enforce_admins: { enabled: body.enforce_admins },
    required_pull_request_reviews: {
      ...body.required_pull_request_reviews,
      dismissal_restrictions: actorResponse(body.required_pull_request_reviews.dismissal_restrictions),
      bypass_pull_request_allowances: actorResponse(body.required_pull_request_reviews.bypass_pull_request_allowances)
    },
    restrictions: actorResponse(body.restrictions),
    required_conversation_resolution: { enabled: body.required_conversation_resolution },
    allow_force_pushes: { enabled: body.allow_force_pushes },
    allow_deletions: { enabled: body.allow_deletions },
    required_linear_history: { enabled: body.required_linear_history },
    block_creations: { enabled: body.block_creations },
    lock_branch: { enabled: body.lock_branch },
    allow_fork_syncing: { enabled: body.allow_fork_syncing }
  };
  if (state.extraVerifiedBypassActor) {
    state.existingProtection.required_pull_request_reviews.bypass_pull_request_allowances ||= {
      users: [], teams: [], apps: []
    };
    state.existingProtection.required_pull_request_reviews.bypass_pull_request_allowances.users.push({
      login: state.extraVerifiedBypassActor
    });
  }
  save(); reply(200, {});
}
reply(404, { message: "Synthetic route not found" });
`;

function initialState(overrides = {}) {
  return {
    vulnerabilityAlerts: false,
    automatedSecurityFixes: false,
    security: {
      secret_scanning: { status: "disabled" },
      secret_scanning_push_protection: { status: "disabled" },
      secret_scanning_validity_checks: { status: "disabled" },
      secret_scanning_non_provider_patterns: { status: "disabled" }
    },
    checks: ["baseline-checks", "guard", "osv-scan", "AI Review"],
    protectionApplied: false,
    calls: [],
    ...overrides
  };
}

function fixture(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "unicorn-security-"));
  const gh = join(directory, "fake-gh.mjs");
  const statePath = join(directory, "state.json");
  writeFileSync(gh, fakeGhSource);
  chmodSync(gh, 0o755);
  writeFileSync(statePath, JSON.stringify(initialState(overrides)));
  return { gh, statePath };
}

function runSecurity(mode, fixtureValue, extraArgs = []) {
  return spawnSync(process.execPath, [
    "scripts/apply-security-settings.mjs",
    mode,
    "--gh",
    fixtureValue.gh,
    "--repo",
    "synthetic/example",
    ...extraArgs
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FAKE_GH_STATE: fixtureValue.statePath }
  });
}

function stateOf(fixtureValue) {
  return JSON.parse(readFileSync(fixtureValue.statePath, "utf8"));
}

test("security activation dry-run performs no mutations", () => {
  const value = fixture();
  const result = runSecurity("--dry-run", value);
  assert.equal(result.status, 0, result.stderr);
  const state = stateOf(value);
  assert.equal(state.calls.some((call) => ["PATCH", "PUT", "DELETE"].includes(call.method)), false);
  assert.equal(state.protectionApplied, false);
  assert.match(result.stdout, /Dry run: no GitHub settings were changed/);
  assert.match(result.stdout, /Would apply branch protection/);
});

test("security activation is idempotent and applies branch protection after verification", () => {
  const value = fixture();
  const first = runSecurity("--apply", value);
  assert.equal(first.status, 0, first.stderr);
  let state = stateOf(value);
  assert.equal(state.vulnerabilityAlerts, true);
  assert.equal(state.automatedSecurityFixes, true);
  assert.equal(state.security.secret_scanning.status, "enabled");
  assert.equal(state.security.secret_scanning_push_protection.status, "enabled");
  assert.equal(state.protectionApplied, true);
  assert.deepEqual(
    state.protectionPayload.required_status_checks.checks.map((item) => item.context),
    ["baseline-checks", "guard", "osv-scan", "AI Review"]
  );
  const protectionCall = state.calls.findIndex((call) => call.path.endsWith("/protection"));
  const lastSecurityMutation = state.calls.reduce((last, call, index) =>
    call.method === "PATCH" || (call.method === "PUT" && !call.path.endsWith("/protection")) ? index : last,
  -1);
  assert.ok(protectionCall > lastSecurityMutation, "branch protection must be the final remote mutation");

  state.calls = [];
  state.protectionApplied = false;
  writeFileSync(value.statePath, JSON.stringify(state));
  const second = runSecurity("--apply", value);
  assert.equal(second.status, 0, second.stderr);
  state = stateOf(value);
  const securityMutations = state.calls.filter((call) =>
    call.method === "PATCH" || (call.method === "PUT" && !call.path.endsWith("/protection"))
  );
  assert.deepEqual(securityMutations, []);
  assert.equal(state.protectionApplied, true);
  assert.match(second.stdout, /already enabled/);
});

test("optional unsupported features are reported without disabling mandatory protection", () => {
  const value = fixture({ unsupportedKey: "secret_scanning_non_provider_patterns" });
  const result = runSecurity("--apply", value);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /\[unsupported\] Secret scanning non-provider patterns/);
  assert.equal(stateOf(value).protectionApplied, true);
});

test("mandatory unsupported features stop activation before branch protection", () => {
  const value = fixture({ unsupportedKey: "secret_scanning" });
  const result = runSecurity("--apply", value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[unsupported\] Secret scanning/);
  assert.doesNotMatch(result.stdout, /activation complete/);
  assert.equal(stateOf(value).protectionApplied, false);
});

test("GitHub API errors are failures rather than success", () => {
  const value = fixture({ failKey: "secret_scanning_push_protection" });
  const result = runSecurity("--apply", value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[failed\] Secret scanning push protection/);
  assert.doesNotMatch(result.stdout, /activation complete/);
  assert.equal(stateOf(value).protectionApplied, false);
});

test("optional feature API errors also stop activation", () => {
  const value = fixture({ failKey: "secret_scanning_validity_checks" });
  const result = runSecurity("--apply", value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[failed\] Secret scanning validity checks/);
  assert.doesNotMatch(result.stdout, /activation complete/);
  assert.equal(stateOf(value).protectionApplied, false);
});

test("accepted mutations must pass postcondition verification", () => {
  const value = fixture({ ignoreKey: "secret_scanning_push_protection" });
  const result = runSecurity("--apply", value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /accepted the update but the enabled state could not be verified/);
  assert.equal(stateOf(value).protectionApplied, false);
});

test("missing required contexts prevent branch protection mutation", () => {
  const enabled = {
    secret_scanning: { status: "enabled" },
    secret_scanning_push_protection: { status: "enabled" },
    secret_scanning_validity_checks: { status: "enabled" },
    secret_scanning_non_provider_patterns: { status: "enabled" }
  };
  const value = fixture({
    vulnerabilityAlerts: true,
    automatedSecurityFixes: true,
    security: enabled,
    checks: ["baseline-checks", "guard", "AI Review"]
  });
  const result = runSecurity("--apply", value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required checks lack workflow-proven evidence/);
  assert.match(result.stderr, /osv-scan/);
  assert.equal(stateOf(value).protectionApplied, false);
});

test("workflows must exist on the default branch before protection", () => {
  const enabled = {
    secret_scanning: { status: "enabled" },
    secret_scanning_push_protection: { status: "enabled" },
    secret_scanning_validity_checks: { status: "enabled" },
    secret_scanning_non_provider_patterns: { status: "enabled" }
  };
  const value = fixture({
    vulnerabilityAlerts: true,
    automatedSecurityFixes: true,
    security: enabled,
    missingWorkflow: "osv-scan.yml"
  });
  const result = runSecurity("--apply", value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required workflow files are not present/);
  assert.match(result.stderr, /osv-scan\.yml/);
  assert.equal(stateOf(value).protectionApplied, false);
});

test("stale check runs do not satisfy required context provenance", () => {
  const enabled = {
    secret_scanning: { status: "enabled" },
    secret_scanning_push_protection: { status: "enabled" },
    secret_scanning_validity_checks: { status: "enabled" },
    secret_scanning_non_provider_patterns: { status: "enabled" }
  };
  const value = fixture({
    vulnerabilityAlerts: true,
    automatedSecurityFixes: true,
    security: enabled,
    staleRuns: true
  });
  const result = runSecurity("--apply", value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lack workflow-proven evidence/);
  assert.equal(stateOf(value).protectionApplied, false);
});

test("feature-branch OSV runs do not satisfy default-head evidence", () => {
  const value = fixture({ osvOnlyOnPullRequest: true });
  const result = runSecurity("--apply", value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /osv-scan/);
  assert.equal(stateOf(value).protectionApplied, false);
});

test("PR-only evidence resolves the base branch when workflow runs omit pull requests", () => {
  const value = fixture({ omitRunPullRequests: true });
  const result = runSecurity("--apply", value);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(stateOf(value).protectionApplied, true);
});

test("installation PR evidence remains valid when the merge commit is newer than the run", () => {
  const value = fixture({ workflowCommitDate: "2099-01-01T00:00:00Z" });
  const result = runSecurity("--apply", value);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(stateOf(value).protectionApplied, true);
});

test("PR-only evidence from a different workflow version is rejected", () => {
  const value = fixture({ stalePrWorkflowVersion: true });
  const result = runSecurity("--apply", value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /guard/);
  assert.match(result.stderr, /AI Review/);
  assert.equal(stateOf(value).protectionApplied, false);
});

test("existing branch protections are preserved while configured controls tighten", () => {
  const value = fixture({
    existingProtection: {
      required_status_checks: { strict: true, checks: [{ context: "legacy", app_id: 42 }] },
      required_pull_request_reviews: {
        dismiss_stale_reviews: false,
        require_code_owner_reviews: true,
        require_last_push_approval: true,
        required_approving_review_count: 2,
        dismissal_restrictions: { users: [{ login: "maintainer" }], teams: [], apps: [] },
        bypass_pull_request_allowances: { users: [], teams: [{ slug: "release" }], apps: [] }
      },
      restrictions: { users: [], teams: [{ slug: "writers" }], apps: [] },
      required_linear_history: { enabled: true },
      block_creations: { enabled: true },
      lock_branch: { enabled: false },
      allow_fork_syncing: { enabled: true }
    }
  });
  const result = runSecurity("--apply", value, ["--approvals", "1"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = stateOf(value).protectionPayload;
  assert.equal(payload.required_pull_request_reviews.required_approving_review_count, 2);
  assert.equal(payload.required_pull_request_reviews.require_code_owner_reviews, true);
  assert.deepEqual(payload.required_pull_request_reviews.dismissal_restrictions.users, ["maintainer"]);
  assert.deepEqual(payload.required_pull_request_reviews.bypass_pull_request_allowances.teams, ["release"]);
  assert.deepEqual(payload.restrictions.teams, ["writers"]);
  assert.equal(payload.required_linear_history, true);
  assert.equal(payload.block_creations, true);
  assert.equal(payload.allow_fork_syncing, true);
  assert.deepEqual(payload.required_status_checks.checks[0], { context: "legacy", app_id: 42 });
});

test("custom target CI contexts are proven by default-head check runs", () => {
  const value = fixture({ customChecks: ["flutter-ci"] });
  const result = runSecurity("--apply", value, [
    "--checks",
    "baseline-checks,guard,osv-scan,AI Review,flutter-ci"
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    stateOf(value).protectionPayload.required_status_checks.checks.map((item) => item.context),
    ["baseline-checks", "guard", "osv-scan", "AI Review", "flutter-ci"]
  );
});

test("custom PR-only contexts use configured workflow evidence", () => {
  const value = fixture({ checks: ["baseline-checks", "guard", "osv-scan", "AI Review", "flutter-pr"] });
  const result = runSecurity("--apply", value, [
    "--checks",
    "baseline-checks,guard,osv-scan,AI Review,flutter-pr",
    "--check-evidence",
    JSON.stringify({
      "flutter-pr": { workflow: ".github/workflows/flutter.yml", mode: "pull-request" }
    })
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(stateOf(value).protectionPayload.required_status_checks.checks.some((item) => item.context === "flutter-pr"));
});

test("branch protection is re-read and verified after mutation", () => {
  const value = fixture({ dropVerifiedCheck: "osv-scan" });
  const result = runSecurity("--apply", value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /postcondition verification failed/);
  assert.match(result.stderr, /osv-scan/);
});

test("unmapped custom checks cannot inherit colliding PR-only evidence", () => {
  const value = fixture({ prCollisionCheck: "consumer-ci" });
  const result = runSecurity("--apply", value, [
    "--checks",
    "baseline-checks,guard,osv-scan,AI Review,consumer-ci"
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /consumer-ci/);
  assert.equal(stateOf(value).protectionApplied, false);
});

test("default-head check evidence paginates with an explicit bound", () => {
  const value = fixture({ customChecks: ["large-ci"], customCheckOnSecondPage: true });
  const result = runSecurity("--apply", value, [
    "--checks",
    "baseline-checks,guard,osv-scan,AI Review,large-ci"
  ]);
  assert.equal(result.status, 0, result.stderr);
  const calls = stateOf(value).calls.filter((call) => call.path.includes("/check-runs?"));
  assert.equal(calls.length, 2);
});

test("branch postconditions reject unexpected review bypass actors", () => {
  const value = fixture({ extraVerifiedBypassActor: "unexpected-actor" });
  const result = runSecurity("--apply", value);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /review bypass allowances/);
});
