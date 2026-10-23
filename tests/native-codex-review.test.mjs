import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyCodexSummaryComment,
  createAiReviewRequestMarkerBody,
  evaluateCodexEvidence,
  hasCodexReviewSignalInEditDiff,
  hasCodexStructuredSummaryInEditDiff,
  isAcceptableCodexSummaryComment,
  isCodexReviewSignal
} from "../scripts/ai-review-helpers.mjs";

const headSha = "0123456789abcdef0123456789abcdef01234567";
const oldSha = "fedcba9876543210fedcba9876543210fedcba98";
const bot = { login: "chatgpt-codex-connector[bot]" };
const triggerAt = "2026-10-01T10:00:00Z";
const resultAt = "2026-10-01T10:02:00Z";
const marker = { agent: "codex", sha: headSha, sourceCommentCreatedAt: triggerAt };
const receipt = `<!-- codex-review-receipt:v1 -->\n\nCodex Review: Didn't find any major issues. :rocket:\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\``;
const comment = (body, extra = {}) => ({ body, user: bot, created_at: resultAt, ...extra });
const state = (overrides = {}) => ({
  code_review: { commit_sha: headSha, has_any_findings: false, has_unresolved_findings: false, status: "completed", ...overrides },
  security_review: { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null }
});
const helpFooter = `<details> <summary>ℹ️ About Codex in GitHub</summary>
<br/>
[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you
- Open a pull request for review
- Mark a draft as ready
- Comment "@codex review" or "@codex security review".
Codex reacts with 👀 while any review is running, comments if it has suggestions, and reacts with 👍 once all reviews finish with no findings.
</details>`;
const summary = (value = state()) => `<!-- codex-pull-request-review-summary -->
<!-- codex-review-state:v1 ${JSON.stringify(value)} -->

## Codex Review Summary

This comment shows the latest Codex review activity on this pull request.

| Review | Status | Commit | Review trigger |
| --- | --- | --- | --- |
| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="2026-10-01T10:02:00Z">2026-10-01T10:02:00Z</relative-time> | \`${headSha.slice(0, 7)}\` | Manual request |${value.security_review.status !== null ? `\n| 🛡️ **Security Review** | ✅ **Completed** | \`${headSha.slice(0, 7)}\` | Manual request |` : ""}`;

const evaluate = (extra) => evaluateCodexEvidence({ headSha, requestMarker: marker, ...extra });

test("native receipt and legacy no-findings preserve explicit head binding", () => {
  for (const body of [receipt, receipt.replace(":rocket:", ":+1:"), receipt + "\n" + helpFooter, receipt.split("\n\n").slice(1).join("\n\n")]) {
    assert.equal(isAcceptableCodexSummaryComment(comment(body), headSha, marker), true);
  }
  assert.equal(evaluate({ comments: [comment(receipt)] }), "pass");
  assert.equal(evaluate({ comments: [comment("Codex Review: Didn't find any major issues.")] }), "pass");
  assert.equal(evaluate({ comments: [comment("Codex Review: Didn't find any major issues.")], timeline: [{ event: "committed", created_at: "2026-10-01T10:01:00Z" }] }), "pending");
});

test("observed native receipt closings remain exact and cannot hide findings", () => {
  const omittedFlags = summary(state({ has_any_findings: null, has_unresolved_findings: null }));
  for (const closing of ["Can't wait for the next one!", "Already looking forward to the next diff.", "Delightful!"]) {
    const body = receipt.replace(":rocket:", closing) + "\n" + helpFooter;
    assert.equal(evaluate({ comments: [comment(body), comment(omittedFlags)] }), "pass");
    assert.equal(runGate({ body, extraComments: [comment(omittedFlags)] }).status, 0);
    for (const invalid of [body.replace(closing, closing + " Found a P1 issue."),
      body.replace(closing, closing + " There is a bug."), body.replace(closing, "An unknown closing."),
      body.replace(headSha.slice(0, 10), oldSha.slice(0, 10))]) {
      assert.notEqual(evaluate({ comments: [comment(invalid), comment(omittedFlags)] }), "pass");
    }
    assert.notEqual(evaluate({ comments: [comment(body, { user: { login: "untrusted[bot]" } }), comment(omittedFlags)] }), "pass");
  }
});

test("receipt rejects forged, missing, stale, malformed, duplicated, and conflicting bindings", () => {
  const invalid = [
    receipt.replace(headSha.slice(0, 10), oldSha.slice(0, 10)),
    receipt.replace(/\n\n\*\*Reviewed commit:[\s\S]*/, ""),
    receipt.replace(headSha.slice(0, 10), "0123456789ZZ"),
    receipt.replace(":v1", ":v2"),
    receipt + "\n<!-- codex-review-receipt:v1 -->",
    receipt + `\n**Reviewed commit:** \`${oldSha}\``,
    receipt + "\nCodex Review: Found a P1 issue.",
    receipt + "\nFound a bug that remains unresolved.",
    receipt.replace("Didn't find any major issues.", "Review in progress."),
    receipt.replace("Didn't find any major issues.", "Found a P2 issue."),
    receipt.replace("**Reviewed commit:**", "Reviewed commit:")
  ];
  for (const body of invalid) assert.notEqual(evaluate({ comments: [comment(body)] }), "pass", body);
  assert.equal(evaluate({ comments: [comment(receipt, { user: { login: "codex-fan" } })] }), "pending");
  assert.equal(evaluate({ comments: [comment(receipt, { created_at: "2026-10-01T09:00:00Z" })] }), "pending");
  assert.equal(isAcceptableCodexSummaryComment(comment(receipt.replace(headSha.slice(0, 10), oldSha)), headSha, marker), false);
});

test("structured state requires exact full SHA, strict schema/types, and completed positive verdict", () => {
  assert.equal(evaluate({ comments: [comment(summary())] }), "pass");
  for (const override of [
    { commit_sha: oldSha }, { commit_sha: headSha.slice(0, 10) }, { commit_sha: null },
    { has_any_findings: "false" }, { has_unresolved_findings: null },
    { has_any_findings: true }, { has_any_findings: true, has_unresolved_findings: true },
    { has_unresolved_findings: true }, { status: "in_progress" }, { status: "failed" }, { status: null },
    { extra: false }
  ]) assert.notEqual(evaluate({ comments: [comment(summary(state(override)))] }), "pass", JSON.stringify(override));
  for (const body of [
    summary().replace('"code_review":', '"code_review":{},"code_review":'),
    summary().replace('"has_any_findings":false', '"has_any_findings":true,"has_any_findings":false'),
    summary().replace('"code_review":', '"unexpected":'),
    summary().replace('"security_review":', '"security_review":false,"unused":'),
    summary().replace(':v1 {', ':v1 {broken'),
    summary() + "\n<!-- codex-review-state:v1 {} -->",
    summary() + "\n<!-- codex-pull-request-review-summary -->",
    summary() + "\nFound a P1 issue.",
    summary() + "\nFound a bug.",
    "## Codex Review Summary\nCompleted 👍"
  ]) assert.notEqual(evaluate({ comments: [comment(body)] }), "pass", body);
});

test("active security review must be completed and finding-free on the exact current head", () => {
  const completed = { commit_sha: headSha, status: "completed", has_any_findings: false, has_unresolved_findings: false };
  assert.equal(evaluate({ comments: [comment(summary({ ...state(), security_review: completed }))] }), "pass");
  for (const overrides of [
    { commit_sha: oldSha }, { status: "running" }, { status: "failed" }, { status: "cancelled" },
    { commit_sha: oldSha, status: "failed" }, { has_any_findings: true },
    { status: "running", has_any_findings: null, has_unresolved_findings: null }
  ]) {
    const body = summary({ ...state(), security_review: { ...completed, ...overrides } });
    assert.notEqual(evaluate({ comments: [comment(body)] }), "pass", JSON.stringify(overrides));
  }
  const escapedDuplicate = summary().replace('"has_any_findings":false', '"has_any_findings":true,"has_any_findin\\u0067s":false');
  assert.notEqual(evaluate({ comments: [comment(escapedDuplicate)] }), "pass");
});

test("structured completed state rejects contradictory visible failure or incomplete status", () => {
  for (const text of ["Review failed", "Review failure", "pending", "in progress", "unresolved",
    "Review incomplete", "Review running", "Review queued", "Review cancelled", "Review blocked", "Review not completed", "Review error",
    "Review in  progress", "Review not **completed**", "in_progress", "changes_requested", "not_completed",
    "inProgress", "changesRequested", "notCompleted", "in-progress", "not-completed", "changes.requested",
    "<details><summary>Review status</summary>Review failed</details>"]) {
    assert.notEqual(evaluate({ comments: [comment(summary() + `\n${text}`)] }), "pass", text);
  }
  const help = helpFooter;
  assert.equal(evaluate({ comments: [comment(summary() + `\n${help}`)] }), "pass");
  const foldedFailure = "<details><summary>Review status</summary>Review failed</details>";
  for (const body of [`${summary()}\n${help}\n${foldedFailure}`, `${summary()}\n${foldedFailure}\n${help}`]) {
    assert.equal(evaluate({ comments: [comment(body)] }), "fail");
  }
  assert.equal(evaluate({ comments: [comment(`Codex Review: Didn't find any major issues.\n<details><summary>Review status</summary>Review pending</details>`)] }), "fail");
});

test("edited summary uses update time and its new exact-head verdict supersedes old evidence", () => {
  const edited = comment(summary(), { created_at: "2026-09-01T00:00:00Z", updated_at: resultAt });
  assert.equal(evaluate({ comments: [edited] }), "pass");
  assert.equal(evaluate({ comments: [{ ...edited, updated_at: "2026-10-01T09:00:00Z" }] }), "pending");
  assert.equal(evaluate({ comments: [{ ...edited, body: summary(state({ commit_sha: oldSha })) }] }), "pending");
  for (const body of [summary(state({ has_any_findings: true })), summary(state({ status: "in_progress" })), summary().replace(':v1 {', ':v1 {bad')]) {
    assert.notEqual(evaluate({ comments: [comment(receipt), { ...edited, body, updated_at: "2026-10-01T10:03:00Z" }] }), "pass");
  }
  assert.equal(classifyCodexSummaryComment(edited, headSha, marker).explicitSha, true);
});

test("accepted negative legacy edits supersede newer passes without refreshing eligibility", () => {
  const edited = comment("Codex Review: Found a P1 issue.", {
    created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z"
  });
  assert.equal(evaluate({ comments: [edited, comment(receipt)] }), "fail");
  assert.equal(evaluate({ comments: [edited], reviews: [{
    id: 1, user: bot, commit_id: headSha, state: "APPROVED", submitted_at: resultAt
  }] }), "fail");
  assert.equal(evaluate({ comments: [{ ...edited, updated_at: resultAt }, comment(receipt)] }), "fail");
  const beforeRequest = { ...edited, created_at: "2026-10-01T09:59:00Z" };
  assert.equal(classifyCodexSummaryComment(beforeRequest, headSha, marker), null);
  assert.notEqual(evaluate({ comments: [beforeRequest, comment(receipt)] }), "pass");
  assert.equal(evaluate({ comments: [edited, comment(receipt, { created_at: "2026-10-01T10:04:00Z" })] }), "pass");
  const editedPositive = { ...edited, body: "Codex Review: Didn't find any major issues." };
  assert.equal(evaluate({ comments: [editedPositive, comment(receipt.replace("Didn't find any major issues.", "Found a P1 issue."))] }), "fail");
});

test("native failures and all unresolved threads survive a new request marker", () => {
  const reviews = [{ id: 1, user: bot, commit_id: headSha, state: "CHANGES_REQUESTED", submitted_at: "2026-10-01T09:59:00Z" }];
  assert.equal(evaluate({ reviews }), "fail");
  for (const login of [bot.login, "chatgpt-codex-connector"]) {
    const threads = [{ isResolved: false, comments: { nodes: [{ author: { login, __typename: "Bot" }, body: "P3 advisory on an earlier head" }] } }];
    assert.equal(evaluate({ comments: [comment(receipt)], threads }), "fail");
    threads[0].isResolved = true;
    assert.equal(evaluate({ comments: [comment(receipt)], threads }), "pass");
  }
  assert.equal(evaluate({ reviews: [{ id: 1, user: bot, state: "APPROVED", submitted_at: resultAt }] }), "pending");
  assert.equal(evaluate({ reviews: [{ id: 1, user: bot, commit_id: headSha, state: "APPROVED", body: "Approved.", submitted_at: resultAt }] }), "pass");
  assert.equal(evaluate({ comments: [comment(receipt)], reviews: [{ ...reviews[0], submitted_at: resultAt }] }), "fail", "failure wins a timestamp tie");
});

function runGate({ body = receipt, clockStep = 0, heads = [headSha], threads = [], reviews = [], extraComments = [], inlineComments = [], deletedEvidence = false, historyNodes = {}, reviewPageInfo = { hasNextPage: false }, graphErrors = null, withdrawalPages = [{ total_count: 0, workflow_runs: [] }], withdrawalApiError = false }) {
  const dir = mkdtempSync(join(tmpdir(), "native-review-gate-"));
  try {
    const markerBody = createAiReviewRequestMarkerBody({ agent: "codex", headSha, requestId: "1", sourceCommentId: "1", sourceCommentCreatedAt: triggerAt, requestedAt: triggerAt });
    const fixture = structuredClone({ heads, clockStep, threads, reviews, inlineComments, historyNodes, reviewPageInfo, graphErrors, withdrawalPages, withdrawalApiError, comments: [comment(markerBody, { user: { login: "github-actions[bot]" } }), ...(deletedEvidence ? [] : [comment(body)]), ...extraComments] });
    for (const [index, item] of fixture.comments.entries()) {
      if (item.user?.login !== bot.login || item.node_id) continue;
      item.node_id = `created-native-${index}`;
      fixture.historyNodes[item.node_id] = { id: item.node_id, body: item.body, updatedAt: item.updated_at || item.created_at,
        lastEditedAt: null, includesCreatedEdit: true, userContentEdits: { nodes: [{ diff: item.body }], pageInfo: { hasNextPage: false } } };
    }
    const preload = join(dir, "fetch.mjs");
    writeFileSync(preload, `const fixture = ${JSON.stringify(fixture)}; let headRead = 0;
      if (fixture.clockStep) { let clock = Date.now(); Date.now = () => clock += fixture.clockStep; }
      globalThis.fetch = async (url, options = {}) => {
        let data;
        if (url.endsWith('/graphql') && JSON.parse(options.body).query.includes('userContentEdits')) { const variables = JSON.parse(options.body).variables; const nodes = fixture.historyNodes[variables.id]; data = { data: { node: Array.isArray(nodes) ? nodes[variables.cursor ? 1 : 0] : nodes } }; }
        else if (url.endsWith('/graphql')) data = { errors: fixture.graphErrors, data: { repository: { pullRequest: { reviews: { nodes: fixture.reviews, pageInfo: fixture.reviewPageInfo }, reviewThreads: { nodes: fixture.threads, pageInfo: { hasNextPage: false } } } } } };
        else if (/\\/pulls\\/1$/.test(url)) data = { number: 1, created_at: '2026-09-01T00:00:00Z', base: { repo: { default_branch: 'main' } }, head: { sha: fixture.heads[Math.min(headRead++, fixture.heads.length - 1)] } };
        else if (url.includes('/workflows/ai-review-rerun.yml/runs')) {
          if (fixture.withdrawalApiError) return { ok: false, status: 403, statusText: 'Forbidden', text: async () => 'Missing Actions read access' };
          data = fixture.withdrawalPages[Number(new URL(url).searchParams.get('page')) - 1];
        }
        else if (url.includes('/issues/1/comments')) data = fixture.comments;
        else if (url.includes('/pulls/1/comments')) data = fixture.inlineComments;
        else if (/\\/(reviews|comments|timeline)\\?/.test(url)) data = [];
        else throw new Error('Unexpected gate request: ' + url);
        return { ok: true, status: 200, json: async () => data };
      };`);
    return spawnSync(process.execPath, ["--import", preload, "scripts/ai-review-gate.mjs"], {
      encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "synthetic", GITHUB_REPOSITORY: "example/project", AI_REVIEW_PR_NUMBER: "1", AI_REVIEW_HEAD_SHA: headSha, AI_REVIEW_AGENT: "codex", AI_REVIEW_TRIGGER_MODE: "skip", AI_REVIEW_WAIT_MS: "0", AI_REVIEW_DEBOUNCE_MS: "0", GITHUB_STEP_SUMMARY: "" }
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("actual gate publishes success only after native evidence and final live-head validation", () => {
  const passed = runGate({});
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /gate passed/);
  assert.equal(runGate({ body: summary() }).status, 0);
  const raced = runGate({ heads: [headSha, headSha, oldSha] });
  assert.equal(raced.status, 1);
  assert.match(raced.stderr, /stale result/);
  assert.equal(runGate({ heads: [headSha, oldSha] }).status, 1, "the withdrawal-scope snapshot also rechecks the live head");
  assert.equal(runGate({ graphErrors: [{ message: "Cannot verify threads" }] }).status, 1);
  assert.equal(runGate({ threads: [{ isResolved: false, comments: { nodes: [{ author: { login: bot.login } }], pageInfo: { hasNextPage: false } } }] }).status, 1);
});


test("native review mutations invalidate earlier receipts using server update time", () => {
  for (const [reviewState, body] of [["DISMISSED", ""], ["COMMENTED", "P1 blocking issue"], ["CHANGES_REQUESTED", ""]]) {
    const review = { id: 2, user: bot, commit_id: headSha, state: reviewState, body,
      submitted_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z" };
    assert.equal(evaluate({ comments: [comment(receipt)], reviews: [review] }), "fail");
    const node = { databaseId: 2, state: review.state, body, commit: { oid: headSha },
      submittedAt: review.submitted_at, updatedAt: review.updated_at,
      author: { login: "chatgpt-codex-connector", __typename: "Bot" } };
    assert.equal(runGate({ reviews: [node] }).status, 1);
    assert.equal(evaluate({ comments: [comment(receipt, { created_at: "2026-10-01T10:04:00Z" })], reviews: [review] }), "pass");
  }
  const oldApproval = { user: bot, commit_id: headSha, state: "APPROVED", body: "Approved.", submitted_at: "2026-10-01T09:59:00Z", updated_at: "2026-10-01T10:03:00Z" };
  assert.equal(evaluate({ reviews: [oldApproval] }), "pending", "positive edits cannot renew request eligibility");
  assert.equal(evaluate({ reviews: [{ ...oldApproval, submitted_at: "2026-10-01T10:01:00Z" }], comments: [comment(receipt.replace("Didn't find any major issues.", "Found a P1 issue."))] }), "fail");
});

test("native review metadata and incomplete pagination fail closed in the actual gate", () => {
  assert.equal(runGate({ reviews: [{ databaseId: 2, state: "APPROVED" }] }).status, 1);
  assert.equal(runGate({ reviewPageInfo: { hasNextPage: true, endCursor: null } }).status, 1);
});


test("destructive native edits invalidate earlier evidence even after all markers disappear", () => {
  const cleared = comment("Review withdrawn", { prior_review_signal: true, node_id: "withdrawn", created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z" });
  assert.equal(evaluate({ comments: [comment(receipt), cleared] }), "pending");
  assert.equal(runGate({ extraComments: [cleared], historyNodes: { withdrawn: {
    id: "withdrawn", body: cleared.body, updatedAt: cleared.updated_at, lastEditedAt: cleared.updated_at, includesCreatedEdit: true,
    userContentEdits: { nodes: [{ diff: cleared.body }, { diff: receipt }], pageInfo: { hasNextPage: false } }
  } } }).status, 1);
  assert.equal(evaluate({ comments: [comment(receipt), { ...cleared, body: "" }] }), "pending");
  assert.equal(evaluate({ comments: [comment(receipt), { ...cleared, user: { login: "untrusted[bot]" } }] }), "pass");
  assert.equal(evaluate({ comments: [cleared, comment(receipt, { created_at: "2026-10-01T10:04:00Z" })] }), "pass");
});


test("edited COMMENTED reviews cannot retain an implicit no-findings result", () => {
  for (const body of ["", "Review withdrawn"]) {
    const review = { id: 2, user: bot, commit_id: headSha, state: "COMMENTED", body,
      submitted_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z", last_edited_at: "2026-10-01T10:03:00Z" };
    assert.equal(evaluate({ reviews: [review] }), body ? "fail" : "pending");
    assert.equal(evaluate({ comments: [comment(receipt)], reviews: [review] }), body ? "fail" : "pending");
    const node = { databaseId: 2, state: review.state, body, commit: { oid: headSha }, submittedAt: review.submitted_at,
      updatedAt: review.updated_at, lastEditedAt: review.last_edited_at, author: { login: "chatgpt-codex-connector", __typename: "Bot" } };
    assert.equal(runGate({ reviews: [node] }).status, 1);
  }
});

test("ordinary native bot replies remain unrelated while missing edit history fails closed", () => {
  const ordinary = comment("Usage limit response", { node_id: "ordinary", created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z" });
  assert.equal(evaluate({ comments: [comment(receipt), ordinary] }), "pass");
  const node = { id: "ordinary", body: ordinary.body, updatedAt: ordinary.updated_at, lastEditedAt: ordinary.updated_at, includesCreatedEdit: true,
    userContentEdits: { nodes: [{ diff: ordinary.body }, { diff: "Command response" }], pageInfo: { hasNextPage: false } } };
  assert.equal(runGate({ extraComments: [ordinary], historyNodes: { ordinary: node } }).status, 0);
  const firstPage = { ...node, userContentEdits: { nodes: [{ diff: ordinary.body }], pageInfo: { hasNextPage: true, endCursor: "next" } } };
  assert.equal(runGate({ extraComments: [ordinary], historyNodes: { ordinary: [firstPage, node] } }).status, 0);
  const formerReview = { ...node, userContentEdits: { ...node.userContentEdits, nodes: [{ diff: receipt }] } };
  const withdrawn = runGate({ extraComments: [ordinary], historyNodes: { ordinary: [firstPage, formerReview] } });
  assert.equal(withdrawn.status, 1);
  assert.doesNotMatch(withdrawn.stderr, /Last API error/);
  assert.equal(runGate({ extraComments: [ordinary], historyNodes: { ordinary: [firstPage, { ...node, updatedAt: "2026-10-01T10:04:00Z" }] } }).status, 1);
  assert.equal(runGate({ extraComments: [ordinary], historyNodes: { ordinary: { ...node, includesCreatedEdit: false } } }).status, 1);
  assert.equal(runGate({ extraComments: [ordinary], historyNodes: { ordinary: { ...node, userContentEdits: { ...node.userContentEdits, nodes: [{ diff: null }] } } } }).status, 1);
});

test("fresh formal approvals and implicit COMMENTED verdicts reject negative and incomplete text", () => {
  for (const reviewState of ["APPROVED", "COMMENTED"]) {
    for (const body of ["Review failed", "Review pending", "Review in_progress", "Review changes_requested", "Review notCompleted", "Review cancelled", "Review blocked", "Review unknown", "Review error", "<details><summary>Review state</summary>Review running</details>"]) {
      const review = { id: 2, user: bot, commit_id: headSha, state: reviewState, body,
        submitted_at: "2026-10-01T10:03:00Z", updated_at: "2026-10-01T10:03:00Z", last_edited_at: null };
      assert.equal(evaluate({ reviews: [review], comments: [comment(receipt)] }), "fail", `${reviewState}: ${body}`);
      const node = { databaseId: 2, state: reviewState, body, submittedAt: review.submitted_at, updatedAt: review.updated_at,
        lastEditedAt: null, commit: { oid: headSha }, author: { login: "chatgpt-codex-connector", __typename: "Bot" } };
      assert.equal(runGate({ reviews: [node] }).status, 1, `${reviewState}: ${body}`);
    }
    const help = { user: bot, commit_id: headSha, state: reviewState, submitted_at: resultAt,
      body: "Approved.\n" + helpFooter };
    assert.equal(evaluate({ reviews: [help] }), "pass");
  }
});

test("withdrawn, revoked, stopped and unavailable review states invalidate every accepted format", () => {
  const states = ["withdrawn", "withdrawal", "revoked", "revocation", "retracted", "rescinded", "rejected", "declined", "denied", "aborted", "abandoned", "paused", "suspended", "skipped", "stopped", "terminated", "expired", "invalid", "unavailable", "inconclusive", "deferred", "unsuccessful", "stale", "outdated", "superseded", "waiting", "timed_out", "action_required", "not_approved", "not_started", "not_reviewed", "not_passed", "not_validated", "not_ready", "not_done", "not successful", "not yet completed", "notFullyCompleted", "never approved", "no_longer_approved", "didn't complete", "hasn’t finished", "cannot be completed", "unable to finish", "can't complete", "withdrawing", "revoking"];
  for (const status of states) {
    const text = `Review ${status}`;
    assert.notEqual(evaluate({ comments: [comment(summary() + "\n" + text)] }), "pass", status);
    assert.notEqual(evaluate({ comments: [comment(receipt + "\n" + text)] }), "pass", status);
    for (const reviewState of ["APPROVED", "COMMENTED"]) {
      const review = { id: 2, user: bot, commit_id: headSha, state: reviewState, body: text,
        submitted_at: "2026-10-01T10:03:00Z", updated_at: "2026-10-01T10:03:00Z", last_edited_at: null };
      assert.equal(evaluate({ comments: [comment(receipt)], reviews: [review] }), "fail", `${reviewState}: ${status}`);
      if (["withdrawn", "revoked"].includes(status)) {
        const node = { databaseId: 2, state: reviewState, body: text, submittedAt: review.submitted_at,
          updatedAt: review.updated_at, lastEditedAt: null, commit: { oid: headSha }, author: { login: "chatgpt-codex-connector", __typename: "Bot" } };
        assert.equal(runGate({ reviews: [node] }).status, 1);
      }
    }
  }
  assert.equal(runGate({ body: summary() + "\nReview withdrawn" }).status, 1);
});


test("fresh formal review bodies need a recognized verdict or explicit advisory priority", () => {
  for (const reviewState of ["APPROVED", "COMMENTED"]) {
    for (const body of ["Codex Review: Found a major bug.", "Detected a major bug.", "There is an untagged security issue.", "Unrecognized review result"]) {
      const review = { id: 2, user: bot, commit_id: headSha, state: reviewState, body,
        submitted_at: "2026-10-01T10:03:00Z", updated_at: "2026-10-01T10:03:00Z", last_edited_at: null };
      assert.notEqual(evaluate({ comments: [comment(receipt)], reviews: [review] }), "pass", `${reviewState}: ${body}`);
      const node = { databaseId: 2, state: reviewState, body, submittedAt: review.submitted_at, updatedAt: review.updated_at,
        lastEditedAt: null, commit: { oid: headSha }, author: { login: "chatgpt-codex-connector", __typename: "Bot" } };
      assert.equal(runGate({ reviews: [node] }).status, 1);
    }
    for (const body of ["Approved.", "No issues found.", "Codex Review: Didn't find any major issues.", "P3 advisory note"]) {
      assert.equal(evaluate({ reviews: [{ user: bot, commit_id: headSha, state: reviewState, body, submitted_at: resultAt }] }), "pass", body);
    }
  }
});

test("blocking inline edits supersede later receipts without renewing old positive reviews", () => {
  for (const reviewState of ["APPROVED", "COMMENTED"]) {
    const review = { id: 2, user: bot, commit_id: headSha, state: reviewState, body: "", submitted_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:01:00Z" };
    const edited = { pull_request_review_id: 2, user: bot, body: "P1 blocker", created_at: review.submitted_at, updated_at: "2026-10-01T10:03:00Z" };
    assert.equal(evaluate({ reviews: [review], reviewComments: [edited], comments: [comment(receipt)] }), "fail");
    const node = { databaseId: 2, state: reviewState, body: "", submittedAt: review.submitted_at, updatedAt: review.updated_at,
      lastEditedAt: null, commit: { oid: headSha }, author: { login: "chatgpt-codex-connector", __typename: "Bot" } };
    assert.equal(runGate({ reviews: [node], inlineComments: [edited] }).status, 1);
    assert.equal(evaluate({ reviews: [review], reviewComments: [{ ...edited, body: "P3 advisory" }], comments: [comment(receipt.replace("Didn't find any major issues.", "Found a P1 issue."))] }), "fail");
    assert.equal(evaluate({ reviews: [review], reviewComments: [{ ...edited, user: { login: "untrusted[bot]" } }], comments: [comment(receipt)] }), "pass");
    const oldNegative = { ...review, state: "CHANGES_REQUESTED" };
    assert.equal(evaluate({ reviews: [oldNegative], reviewComments: [{ ...edited, body: "P3 advisory" }], comments: [comment(receipt)] }), "pass", "benign advisory edits cannot refresh an older negative formal state");
  }
});

test("actual gate loses success after the only native receipt is deleted", () => {
  assert.equal(runGate({}).status, 0);
  const deleted = runGate({ deletedEvidence: true });
  assert.equal(deleted.status, 1);
  assert.doesNotMatch(deleted.stderr, /Last API error/);
});


test("positive native envelopes reject arbitrary finding prose and unknown rendering", () => {
  for (const prose of ["A major bug remains.", "Detected a security issue.", "Something needs fixing.", "Approved. A bug remains."]) {
    for (const body of [summary() + "\n" + prose, receipt + "\n" + prose]) {
      assert.notEqual(evaluate({ comments: [comment(body)] }), "pass", prose);
      assert.equal(runGate({ body }).status, 1, prose);
    }
  }
  const rendered = summary();
  assert.equal(evaluate({ comments: [comment(rendered)] }), "pass");
  assert.equal(runGate({ body: rendered }).status, 0);
  for (const body of [rendered + "\nA major bug remains.", rendered.replace("Manual request", "A major bug remains."), rendered.replace(headSha.slice(0, 7) + "`", oldSha.slice(0, 7) + "`")]) {
    assert.notEqual(evaluate({ comments: [comment(body)] }), "pass");
  }
});

test("deleting the last inline finding cannot create an implicit positive formal verdict", () => {
  for (const reviewState of ["COMMENTED", "APPROVED"]) {
    const review = { id: 2, user: bot, state: reviewState, commit_id: headSha, body: "", submitted_at: resultAt, updated_at: resultAt, last_edited_at: null };
    const finding = { pull_request_review_id: 2, user: bot, body: "P1 blocker", created_at: resultAt };
    assert.equal(evaluate({ reviews: [review], reviewComments: [finding] }), "fail");
    assert.equal(evaluate({ reviews: [review], reviewComments: [] }), "pending");
    const node = { databaseId: 2, state: reviewState, body: "", submittedAt: resultAt, updatedAt: resultAt,
      lastEditedAt: null, commit: { oid: headSha }, author: { login: "chatgpt-codex-connector", __typename: "Bot" } };
    assert.equal(runGate({ deletedEvidence: true, reviews: [node] }).status, 1);
    assert.equal(evaluate({ reviews: [review], comments: [comment(receipt, { created_at: "2026-10-01T10:04:00Z" })] }), "pass", "a fresh explicit native verdict can establish success");
  }
});


test("structured positive state requires the complete native table", () => {
  const truncated = summary().replace(/This comment shows[\s\S]*/, "Completed");
  assert.equal(evaluate({ comments: [comment(truncated)] }), "pending");
  assert.equal(runGate({ body: truncated }).status, 1);
  for (const body of [summary().replace(/\| 📝[^\n]+/, ""), summary().replace("Code Review", "Security Review"), summary() + "\n| 📝 **Code Review** | ✅ **Completed** | `0123456` | Manual request |"])
    assert.notEqual(evaluate({ comments: [comment(body)] }), "pass");
});

test("only the complete standard help footer is excluded from every verdict", () => {
  for (const text of ["A major bug remains.", "Review failed.", "Review pending.", "Approved. A security issue remains."]) {
    for (const label of ["About Codex", "ℹ️ About Codex in GitHub"]) {
      const footer = `<details><summary>${label}</summary><br/>${text}</details>`;
      for (const body of [receipt, summary()]) {
        assert.notEqual(evaluate({ comments: [comment(body + "\n" + footer)] }), "pass", text);
        assert.equal(runGate({ body: body + "\n" + footer }).status, 1);
      }
      for (const reviewState of ["APPROVED", "COMMENTED"]) {
        assert.notEqual(evaluate({ reviews: [{ user: bot, state: reviewState, commit_id: headSha, submitted_at: resultAt, body: "Approved.\n" + footer }] }), "pass");
      }
    }
  }
  const modifiedHelp = helpFooter.replace("this repo", "this repo. A major bug remains");
  assert.notEqual(evaluate({ comments: [comment(summary() + "\n" + modifiedHelp)] }), "pass");
  assert.equal(evaluate({ comments: [comment(summary() + "\n" + helpFooter)] }), "pass");
});

const withdrawal = (extra = {}) => comment(`<!-- unicorn-hub:ai-review-withdrawal:v1 ${JSON.stringify({ agent: "codex", head_sha: headSha, pr_number: 1, source_created_at: "2026-10-01T10:03:00Z", source_run_id: 42 })} -->`, {
  user: { login: "github-actions[bot]" }, created_at: "2026-10-01T10:03:10Z", ...extra
});

test("later wakeups cannot pass while the independent withdrawal writer is pending or failed", () => {
  const source = { id: 42, repository: { full_name: "example/project" }, event: "issue_comment",
    path: ".github/workflows/ai-review-rerun.yml@main", head_branch: "main", created_at: "2026-10-01T10:03:00Z",
    display_title: "AI review evidence:issue_comment:deleted:1:chatgpt-codex-connector[bot]:false:true:false" };
  const fresh = comment(summary({ ...state(), security_review: { ...state().code_review } }).replace("✅ **Completed** |", '✅ **Completed** <relative-time datetime="2026-10-01T10:02:00Z">2026-10-01T10:02:00Z</relative-time> |').replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:04:00Z"), { created_at: "2026-10-01T10:04:00Z" });
  const pages = (runs) => [{ total_count: runs.length, workflow_runs: runs }];
  for (const status of ["queued", "in_progress", "completed"]) {
    const runs = [{ ...source, status, conclusion: status === "completed" ? "failure" : null }];
    const blocked = runGate({ extraComments: [fresh], withdrawalPages: pages(runs) });
    assert.equal(blocked.status, 1, status);
    assert.doesNotMatch(blocked.stderr, /Last API error/);
    assert.equal(runGate({ extraComments: [withdrawal(), fresh], withdrawalPages: pages(runs) }).status, 0);
    assert.equal(runGate({ extraComments: [withdrawal()], withdrawalPages: pages(runs) }).status, 1, "a record still needs a newer whole-review snapshot");
  }
  for (const invalid of [withdrawal({ user: { login: "untrusted[bot]" } }),
    withdrawal({ body: withdrawal().body.replace('"source_run_id":42', '"source_run_id":43') }),
    withdrawal({ created_at: "2026-10-01T10:01:00Z" })]) {
    assert.equal(runGate({ extraComments: [invalid, fresh], withdrawalPages: pages([source]) }).status, 1);
  }
  const processedOldHead = withdrawal({ body: withdrawal().body.replace(headSha, oldSha) });
  assert.equal(runGate({ extraComments: [processedOldHead, fresh], withdrawalPages: pages([source]) }).status, 0);
  for (const unrelated of [{ ...source, display_title: source.display_title.replace(":deleted:1:", ":deleted:2:") },
    { ...source, path: ".github/workflows/other.yml" }, { ...source, repository: { full_name: "example/other" } },
    { ...source, display_title: source.display_title.replace(bot.login, "untrusted[bot]") }]) {
    assert.equal(runGate({ withdrawalPages: pages([unrelated]) }).status, 0);
  }
  const otherRuns = Array.from({ length: 100 }, (_, index) => ({ id: index + 100, display_title: "Unrelated" }));
  assert.equal(runGate({ withdrawalPages: [{ total_count: 101, workflow_runs: otherRuns }, { total_count: 101, workflow_runs: [source] }] }).status, 1);
  assert.equal(runGate({ withdrawalApiError: true }).status, 1);
  for (const page of [{ total_count: 1001, workflow_runs: [] }, { total_count: 1, workflow_runs: [] }, { total_count: 0 }]) {
    assert.equal(runGate({ withdrawalPages: [page] }).status, 1);
  }
});

test("durable deletion tombstones invalidate every pre-deletion positive verdict", () => {
  for (const reviewState of ["COMMENTED", "APPROVED"]) {
    for (const body of ["", "Approved."]) {
      const review = { id: 2, user: bot, state: reviewState, commit_id: headSha, body, submitted_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:01:00Z" };
      for (const positive of [receipt, summary()]) {
        assert.notEqual(evaluate({ reviews: [review], comments: [comment(positive), withdrawal()] }), "pass");
        assert.equal(runGate({ body: positive, extraComments: [withdrawal()] }).status, 1);
        assert.equal(evaluate({ reviews: [review], comments: [comment(positive.replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:04:00Z"), { created_at: "2026-10-01T10:04:00Z" }), withdrawal()] }), positive === receipt ? "pending" : "pass");
        assert.equal(evaluate({ reviews: [review], comments: [comment(summary({ ...state(), security_review: { ...state().code_review } }).replace("✅ **Completed** |", '✅ **Completed** <relative-time datetime="2026-10-01T10:02:00Z">2026-10-01T10:02:00Z</relative-time> |').replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:04:00Z"), { created_at: "2026-10-01T10:04:00Z" }), withdrawal()] }), "pass");
      }
      assert.notEqual(evaluate({ reviews: [review], comments: [withdrawal()] }), "pass");
    }
  }
  assert.equal(evaluate({ comments: [comment(receipt), withdrawal({ user: { login: "untrusted-user" } })] }), "pass");
  assert.equal(evaluate({ comments: [comment(receipt), withdrawal({ body: withdrawal().body.replace(headSha, oldSha) })] }), "pass");
  for (const body of [withdrawal().body.replace(":v1", ":v2"), withdrawal().body.replace('"agent":"codex"', '"agent":"other","agent":"codex"')])
    assert.equal(evaluate({ comments: [comment(receipt), withdrawal({ body })] }), "pending");
});


test("legacy review markers survive prefixed and HTML-rendered edit histories", () => {
  const cleared = comment("Ordinary text", { node_id: "diff-review", created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z" });
  for (const diff of [
    "-Codex Review: Found a P1 bug.\n+Ordinary text",
    "<del>Codex Review: Found a P1 bug.</del><ins>Ordinary text</ins>",
    "<del>Codex Review: Review withdrawn</del>",
    "<del>Codex</del> Review: Found a bug.",
    "&#67;odex Review: Found a bug."
  ]) {
    const result = runGate({ extraComments: [cleared], historyNodes: { "diff-review": {
      id: "diff-review", body: cleared.body, updatedAt: cleared.updated_at, lastEditedAt: cleared.updated_at, includesCreatedEdit: true,
      userContentEdits: { nodes: [{ diff }], pageInfo: { hasNextPage: false } }
    } } });
    assert.equal(result.status, 1, diff);
    assert.doesNotMatch(result.stderr, /Last API error/);
  }
});


test("later code-only evidence cannot override the latest native summary's whole-review state", () => {
  const positive = comment(receipt, { created_at: "2026-10-01T10:03:00Z" });
  const approval = { user: bot, state: "APPROVED", body: "Approved.", commit_id: headSha, submitted_at: "2026-10-01T10:03:00Z" };
  const security = { commit_sha: headSha, status: "running", has_any_findings: false, has_unresolved_findings: false };
  const bodies = [
    summary({ ...state(), security_review: security }),
    summary({ ...state(), security_review: { ...security, status: "completed", has_any_findings: true } }),
    summary({ ...state(), security_review: { ...security, status: "completed", commit_sha: oldSha } }),
    summary(state({ status: "running" })), summary(state({ has_any_findings: true })),
    summary().replace(':v1 {', ':v1 {bad'), summary(state({ commit_sha: oldSha }))
  ];
  for (const body of bodies) {
    const snapshot = comment(body);
    for (const extra of [{ comments: [snapshot, positive] }, { comments: [snapshot], reviews: [approval] }]) {
      assert.notEqual(evaluate(extra), "pass", body);
    }
    assert.equal(runGate({ body: positive.body, extraComments: [snapshot] }).status, 1);
    assert.equal(evaluate({ comments: [snapshot, positive, comment(summary({ ...state(), security_review: { ...state().code_review } }).replace("✅ **Completed** |", '✅ **Completed** <relative-time datetime="2026-10-01T10:02:00Z">2026-10-01T10:02:00Z</relative-time> |').replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:04:00Z"), { created_at: "2026-10-01T10:04:00Z" })] }), "pass", "a newer complete authoritative snapshot restores success");
  }
  assert.equal(evaluate({ comments: [positive, comment(bodies[0], { user: { login: "untrusted[bot]" } })] }), "pass");
});


test("edit-history additions and quoted legacy phrases do not withdraw ordinary replies", () => {
  const ordinary = comment("Command response", { node_id: "ordinary-diff", created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z" });
  for (const diff of [
    "- Command response\n+ Codex Review: reference only",
    "<del>Command response</del><ins>Codex Review: reference only</ins>",
    "<div>Example: <del>Codex Review: reference</del><ins>updated</ins></div>",
    "- Example: Codex Review: reference\n+ Command response",
    "Example: Codex Review: reference", "> Codex Review: quoted reference",
    "- Codex Review: a markdown list item",
    "<ins>&lt;!-- codex-review-receipt:v1 --&gt;</ins>Command response"
  ]) {
    const result = runGate({ extraComments: [ordinary], historyNodes: { "ordinary-diff": {
      id: "ordinary-diff", body: ordinary.body, updatedAt: ordinary.updated_at, lastEditedAt: ordinary.updated_at, includesCreatedEdit: true,
      userContentEdits: { nodes: [{ diff }], pageInfo: { hasNextPage: false } }
    } } });
    assert.equal(result.status, 0, diff);
  }
});


test("removed structured state requires a newer complete structured snapshot", () => {
  const later = comment(receipt, { created_at: "2026-10-01T10:04:00Z" });
  for (const body of ["Ordinary text", receipt]) {
    const removed = comment(body, { node_id: "removed-summary", prior_review_signal: true, prior_structured_summary: true,
      created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z" });
    for (const oldState of [summary(state({ status: "running" })), summary({ ...state(), security_review: {
      commit_sha: headSha, status: "failed", has_any_findings: true, has_unresolved_findings: true
    } })]) {
      const history = { id: removed.node_id, body, updatedAt: removed.updated_at, lastEditedAt: removed.updated_at,
        includesCreatedEdit: true, userContentEdits: { nodes: [{ diff: oldState }], pageInfo: { hasNextPage: false } } };
      assert.notEqual(evaluate({ comments: [removed, later] }), "pass");
      const blocked = runGate({ extraComments: [removed, later], historyNodes: { [removed.node_id]: history } });
      assert.equal(blocked.status, 1, blocked.stdout);
      assert.doesNotMatch(blocked.stderr, /Last API error/);
      const recovered = comment(summary().replaceAll(resultAt, "2026-10-01T10:05:00Z"), { created_at: "2026-10-01T10:05:00Z" });
      assert.equal(evaluate({ comments: [removed, later, recovered] }), "pass");
      const restored = runGate({ extraComments: [removed, later, recovered], historyNodes: { [removed.node_id]: history } });
      assert.equal(restored.status, 0, restored.stderr);
    }
  }
});


test("legacy verdicts use the same case-insensitive column-zero grammar as deletion routing", () => {
  const legacy = "codex review: Didn't find any major issues.";
  assert.equal(isCodexReviewSignal(legacy), true);
  assert.equal(isAcceptableCodexSummaryComment(comment(legacy), headSha, marker), true);
  for (const prefix of [" ", "\n", "\t", "\u00a0"]) {
    assert.equal(isCodexReviewSignal(prefix + legacy), false);
    assert.equal(isAcceptableCodexSummaryComment(comment(prefix + legacy), headSha, marker), false);
  }
  assert.equal(runGate({ extraComments: [withdrawal(), comment(receipt, { created_at: "2026-10-01T10:04:00Z" })] }).status, 1);
  assert.equal(runGate({ extraComments: [withdrawal(), comment(summary({ ...state(), security_review: { ...state().code_review } }).replace("✅ **Completed** |", '✅ **Completed** <relative-time datetime="2026-10-01T10:02:00Z">2026-10-01T10:02:00Z</relative-time> |').replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:04:00Z"), { created_at: "2026-10-01T10:04:00Z" })] }).status, 0);
});

test("edit history preserves the prior body's own leading whitespace", () => {
  const legacy = "Codex Review: Didn't find any major issues.";
  const ordinary = comment("Ordinary reply", { node_id: "whitespace-history",
    created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z" });
  for (const prefix of ["", " ", "\t", "\n", "\u00a0"]) {
    const prior = prefix + legacy;
    const removedLines = prior.split("\n").map((line) => `-${line}`).join("\n");
    const diffs = [prior, `${removedLines}\n+Ordinary reply`,
      `@@ -1 +1 @@\n${removedLines}\n+Ordinary reply`,
      `<del>${prior}</del><ins>Ordinary reply</ins>`];
    for (const diff of diffs) {
      assert.equal(hasCodexReviewSignalInEditDiff(diff), prefix === "", diff);
      const result = runGate({ extraComments: [ordinary], historyNodes: { [ordinary.node_id]: {
        id: ordinary.node_id, body: ordinary.body, updatedAt: ordinary.updated_at,
        lastEditedAt: ordinary.updated_at, includesCreatedEdit: true,
        userContentEdits: { nodes: [{ diff }], pageInfo: { hasNextPage: false } }
      } } });
      assert.equal(result.status, prefix === "" ? 1 : 0, diff);
      assert.doesNotMatch(result.stderr, /Last API error/);
    }
  }
});

test("unified edit history preserves content boundaries and removes only file metadata", () => {
  const legacy = "Codex Review: Didn't find any major issues.";
  const ordinary = comment("Ordinary reply", { node_id: "content-history",
    created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z" });
  for (const [diff, signal] of [
    [`@@ -1,2 +1,2 @@\n----\n+***\n ${legacy}`, false],
    [`@@ -1,2 +1,2 @@\n--- title\n+++ title\n ${legacy}`, false],
    [`--- title\n+++ title\n ${legacy}`, false],
    [`@@ -8 +8 @@\n-${legacy}\n+Ordinary reply`, false],
    [`diff --git a/comment b/comment\nindex 123..456 100644\n--- a/comment\n+++ b/comment\n@@ -1 +1 @@\n-${legacy}\n+Ordinary reply`, true],
    [`--- a/comment\n+++ b/comment\n@@ -8 +8 @@\n-${legacy}\n+Ordinary reply`, false]
  ]) {
    assert.equal(hasCodexReviewSignalInEditDiff(diff), signal, diff);
    const result = runGate({ extraComments: [ordinary], historyNodes: { [ordinary.node_id]: {
      id: ordinary.node_id, body: ordinary.body, updatedAt: ordinary.updated_at,
      lastEditedAt: ordinary.updated_at, includesCreatedEdit: true,
      userContentEdits: { nodes: [{ diff }], pageInfo: { hasNextPage: false } }
    } } });
    assert.equal(result.status, signal ? 1 : 0, diff);
    assert.doesNotMatch(result.stderr, /Last API error/);
  }
});

test("HTML edit history preserves structural containers around legacy-like text", () => {
  const legacy = "Codex Review: reference";
  const ordinary = comment("Ordinary reply", { node_id: "html-container-history",
    created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z" });
  for (const [open, close] of [["<blockquote>", "</blockquote>"], ["<div>", "</div>"],
    ["<ul><li>", "</li></ul>"], ["<pre><code>", "</code></pre>"], ["<p>", "</p>"], ["<span>", "</span>"]]) {
    for (const [prior, signal] of [[legacy, false], [receipt, true]]) {
      const diff = `${open}<del>${prior}</del>${close}<ins>Ordinary reply</ins>`;
      assert.equal(hasCodexReviewSignalInEditDiff(diff), signal, diff);
      const result = runGate({ extraComments: [ordinary], historyNodes: { [ordinary.node_id]: {
        id: ordinary.node_id, body: ordinary.body, updatedAt: ordinary.updated_at,
        lastEditedAt: ordinary.updated_at, includesCreatedEdit: true,
        userContentEdits: { nodes: [{ diff }], pageInfo: { hasNextPage: false } }
      } } });
      assert.equal(result.status, signal ? 1 : 0, diff);
      assert.doesNotMatch(result.stderr, /Last API error/);
    }
  }
});

test("HTML history excludes tag names and quoted attributes from prior evidence", () => {
  const ordinary = comment("New reply", { node_id: "html-attribute-history",
    created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z" });
  for (const diff of [
    '<div class="codex-pull-request-review-summary"><del>Ordinary reply</del></div><ins>New reply</ins>',
    '<div title="codex-review-state: > <!-- codex-review-receipt:v1 -->"><del>Ordinary reply</del></div>',
    "<div title='codex-review-state: < > <!-- codex-review-receipt:v1 -->'><del>Ordinary reply</del></div>",
    '<div title="&#34;>codex-review-state:"><del>Ordinary reply</del></div><ins>New reply</ins>',
    '<codex-pull-request-review-summary><del>Ordinary reply</del></codex-pull-request-review-summary>',
    '<del data-state="codex-review-state:">Ordinary reply</del><ins>New reply</ins>',
    '<ins title="<!-- codex-review-receipt:v1 -->">Added reference</ins><del>Ordinary reply</del>',
    '<ins>Added <ins>nested</ins> <!-- codex-review-receipt:v1 --> codex-review-state:</ins><del>Ordinary reply</del>'
  ]) {
    assert.equal(hasCodexReviewSignalInEditDiff(diff), false, diff);
    assert.equal(hasCodexStructuredSummaryInEditDiff(diff), false, diff);
    const result = runGate({ extraComments: [ordinary], historyNodes: { [ordinary.node_id]: {
      id: ordinary.node_id, body: ordinary.body, updatedAt: ordinary.updated_at,
      lastEditedAt: ordinary.updated_at, includesCreatedEdit: true,
      userContentEdits: { nodes: [{ diff }], pageInfo: { hasNextPage: false } }
    } } });
    assert.equal(result.status, 0, diff);
  }
  assert.equal(hasCodexStructuredSummaryInEditDiff(`<div title="unrelated"><del>${summary()}</del></div>`), true);
});

test("escaped tag text cannot close an HTML insertion before tokenization", () => {
  const ordinary = comment("New reply", { node_id: "html-entity-history",
    created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:03:00Z" });
  for (const close of ["&lt;/ins&gt;", "&#60;/ins&#62;", "&#x3c;/ins&#x3e;"]) {
    const diff = `<ins>New ${close} codex-review-state: <!-- codex-review-receipt:v1 --></ins><del>Ordinary reply</del>`;
    assert.equal(hasCodexReviewSignalInEditDiff(diff), false, diff);
    assert.equal(hasCodexStructuredSummaryInEditDiff(diff), false, diff);
    const result = runGate({ extraComments: [ordinary], historyNodes: { [ordinary.node_id]: {
      id: ordinary.node_id, body: ordinary.body, updatedAt: ordinary.updated_at,
      lastEditedAt: ordinary.updated_at, includesCreatedEdit: true,
      userContentEdits: { nodes: [{ diff }], pageInfo: { hasNextPage: false } }
    } } });
    assert.equal(result.status, 0, diff);
  }
  assert.equal(hasCodexReviewSignalInEditDiff("&lt;del&gt;Codex Review: reference&lt;/del&gt;"), false);
  assert.equal(hasCodexReviewSignalInEditDiff(`<del>${receipt.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</del>`), true);
});


test("zero-wait validation always takes its initial snapshot despite advancing time", () => {
  const positive = runGate({ clockStep: 1 });
  assert.equal(positive.status, 0, positive.stderr);
  assert.match(positive.stdout, /gate passed/);
  const negative = runGate({ clockStep: 1, body: receipt.replace("Didn't find any major issues.", "Found a P1 issue.") });
  assert.equal(negative.status, 1);
  assert.doesNotMatch(negative.stderr, /Last API error/);
  assert.equal(runGate({ clockStep: 1, heads: [headSha, oldSha] }).status, 1);
});


test("completed summaries with omitted code flags require an independent current-request receipt", () => {
  const body = summary(state({ has_any_findings: null, has_unresolved_findings: null }));
  const thumbReceipt = receipt.replace(":rocket:", ":+1:") + "\n" + helpFooter;
  assert.equal(classifyCodexSummaryComment(comment(body), headSha, marker).result, "pending");
  assert.equal(isAcceptableCodexSummaryComment(comment(body), headSha, marker), false);
  assert.equal(evaluate({ comments: [comment(body)] }), "pending");
  assert.equal(evaluate({ comments: [comment(body), comment(thumbReceipt)] }), "pass");
  const actual = runGate({ body, extraComments: [comment(thumbReceipt)] });
  assert.equal(actual.status, 0, actual.stderr);
  for (const invalid of [
    comment(thumbReceipt, { user: { login: "untrusted[bot]" } }),
    comment(thumbReceipt.replace(headSha.slice(0, 10), oldSha.slice(0, 10))),
    comment(thumbReceipt, { created_at: "2026-10-01T09:59:00Z", updated_at: "2026-10-01T10:03:00Z" }),
    comment("Codex Review: Didn't find any major issues."), comment(thumbReceipt.replace(":v1", ":v2")),
    comment(thumbReceipt.replace("Didn't find any major issues.", "Found a P1 issue."))
  ]) assert.notEqual(evaluate({ comments: [comment(body), invalid] }), "pass");
  assert.notEqual(evaluate({ comments: [comment(body)], reviews: [{ user: bot, state: "APPROVED", body: "Approved.", commit_id: headSha, submitted_at: resultAt }] }), "pass");
  const laterSummary = comment(body, { created_at: resultAt, updated_at: "2026-10-01T10:04:00Z" });
  for (const intervening of [
    { comments: [comment(receipt.replace("Didn't find any major issues.", "Found a P1 issue."), { created_at: "2026-10-01T10:03:00Z" })] },
    { comments: [comment("<!-- codex-review-receipt:v2 -->", { created_at: "2026-10-01T10:03:00Z" })] },
    { reviews: [{ user: bot, state: "CHANGES_REQUESTED", commit_id: headSha, submitted_at: "2026-10-01T10:03:00Z" }] }
  ]) {
    const items = [comment(thumbReceipt), laterSummary, ...(intervening.comments || [])];
    assert.notEqual(evaluate({ ...intervening, comments: items }), "pass", "the summary cannot renew an older receipt over intervening evidence");
    assert.equal(evaluate({ ...intervening, comments: [...items, comment(thumbReceipt, { created_at: "2026-10-01T10:05:00Z" })] }), "pass");
  }
  const security = { commit_sha: headSha, status: "running", has_any_findings: false, has_unresolved_findings: false };
  for (const invalidBody of [
    summary(state({ has_any_findings: null })), summary(state({ has_any_findings: null, has_unresolved_findings: null, status: "running" })),
    summary(state({ has_any_findings: null, has_unresolved_findings: null, commit_sha: oldSha })),
    summary({ ...state({ has_any_findings: null, has_unresolved_findings: null }), security_review: security }),
    summary({ ...state({ has_any_findings: null, has_unresolved_findings: null }), security_review: { ...security, status: "completed", has_any_findings: null, has_unresolved_findings: null } }),
    body + "\nReview failed", body.replace(':v1 {', ':v1 {bad')
  ]) assert.notEqual(evaluate({ comments: [comment(invalidBody), comment(thumbReceipt)] }), "pass", invalidBody);
  assert.equal(evaluate({ comments: [comment(body), comment(thumbReceipt)], threads: [{ isResolved: false, comments: { nodes: [{ author: { login: bot.login } }] } }] }), "fail");
});

test("corroborated structured recovery requires both artifacts after withdrawal", () => {
  const body = summary(state({ has_any_findings: null, has_unresolved_findings: null }));
  const freshReceipt = comment(receipt, { created_at: "2026-10-01T10:05:00Z" });
  const freshSummary = comment(body.replaceAll(resultAt, "2026-10-01T10:04:00Z"), { created_at: "2026-10-01T10:04:00Z" });
  assert.equal(evaluate({ comments: [comment(body), freshReceipt, withdrawal()] }), "pending");
  assert.equal(evaluate({ comments: [freshSummary, comment(receipt), withdrawal()] }), "pending");
  assert.equal(evaluate({ comments: [freshSummary, freshReceipt, withdrawal()] }), "pass");
  const removed = comment("Ordinary text", { prior_review_signal: true, prior_structured_summary: true,
    created_at: resultAt, updated_at: "2026-10-01T10:03:00Z" });
  assert.equal(evaluate({ comments: [removed, freshReceipt] }), "pending");
  assert.equal(evaluate({ comments: [removed, freshSummary, comment(receipt)] }), "pending");
  assert.equal(evaluate({ comments: [removed, freshSummary, freshReceipt] }), "pass");
});


test("edited code-only positives cannot renew their age over intervening failures", () => {
  const unknown = comment(summary(state({ has_any_findings: null, has_unresolved_findings: null })), { created_at: resultAt, updated_at: "2026-10-01T10:05:00Z" });
  const negative = comment(receipt.replace("Didn't find any major issues.", "Found a P1 issue."), { created_at: "2026-10-01T10:03:00Z" });
  for (const body of [receipt, receipt.replace("<!-- codex-review-receipt:v1 -->\n\n", "")]) {
    const edited = comment(body, { node_id: "edited-positive", created_at: resultAt, updated_at: "2026-10-01T10:04:00Z" });
    assert.notEqual(evaluate({ comments: [edited, negative, unknown] }), "pass");
    assert.notEqual(evaluate({ comments: [edited, negative] }), "pass");
    assert.notEqual(evaluate({ comments: [edited, unknown], reviews: [{ user: bot, state: "CHANGES_REQUESTED", commit_id: headSha, submitted_at: negative.created_at }] }), "pass");
    const result = runGate({ extraComments: [edited, negative, unknown], historyNodes: { "edited-positive": {
      id: edited.node_id, body, updatedAt: edited.updated_at, lastEditedAt: edited.updated_at, includesCreatedEdit: true,
      userContentEdits: { nodes: [{ diff: body }], pageInfo: { hasNextPage: false } }
    } } });
    assert.equal(result.status, 1, result.stdout);
    assert.doesNotMatch(result.stderr, /Last API error/);
    const fresh = comment(receipt, { created_at: "2026-10-01T10:06:00Z" });
    assert.equal(evaluate({ comments: [edited, negative, unknown, fresh] }), "pass");
    assert.equal(evaluate({ comments: [edited, negative, fresh] }), "pass");
  }
});


test("unseen receipt presentation is neutral only under independent affirmative machine proof", () => {
  for (const closing of ["You're on a roll.", "Another round soon, please!", "Chef's kiss.", "Swish!", "A sparkling little triumph!", "No worries!"]) {
    const body = receipt.replace(":rocket:", closing);
    assert.notEqual(evaluate({ comments: [comment(body)] }), "pass");
    for (const time of ["2026-10-01T10:01:00Z", "2026-10-01T10:03:00Z"]) {
      const comments = [comment(body, { created_at: time }), comment(summary())];
      assert.equal(evaluate({ comments }), time < resultAt ? "pass" : "pending", closing);
    }
    assert.notEqual(evaluate({ comments: [comment(body), comment(summary(state({ has_any_findings: null, has_unresolved_findings: null })))] }), "pass");
  }
  for (const suffix of ["Authentication leaks credentials.", "The deployment deletes all customer data.", "Found a P0 issue.", "Found a P1 issue.", "Found a P2 issue.", "Review incomplete.", "<!-- unknown -->", "Status: completed", "\nExtra line", "Codex Review: Approved."]) {
    assert.notEqual(evaluate({ comments: [comment(summary()), comment(receipt.replace(":rocket:", suffix), { created_at: "2026-10-01T10:03:00Z" })] }), "pass", suffix);
  }
  assert.notEqual(evaluate({ comments: [comment(receipt.replace(":rocket:", "Swish!")), comment(summary(), { created_at: triggerAt })] }), "pass");
});


test("equal-time invalid machine signals outrank clean proof around opaque receipts", () => {
  const opaque = comment(receipt.replace(":rocket:", "Swish!"));
  for (const body of [summary(state({ commit_sha: oldSha })), summary().replace(':v1', ':v2'), summary().replace(':v1 {', ':v1 {bad'), summary(state({ status: "running" }))]) {
    for (const snapshots of [[comment(summary()), comment(body)], [comment(body), comment(summary())]])
      assert.notEqual(evaluate({ comments: [...snapshots, opaque] }), "pass", body);
  }
  const good = receipt.replace(":rocket:", "Swish!");
  assert.equal(runGate({ body: good, extraComments: [comment(summary().replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:03:00Z"), { created_at: "2026-10-01T10:03:00Z" })] }).status, 0);
  for (const body of [good + "\n<!-- codex-review-receipt:v1 -->", good + "\n<!-- unknown -->", good + "\nP0: issue", good + "\n**Reviewed commit:** `0123456789`", good + "\n<details> <summary>ℹ️ About Codex in GitHub</summary> P0: issue </details>"])
    assert.notEqual(evaluate({ comments: [comment(summary()), comment(body, { created_at: "2026-10-01T10:03:00Z" })] }), "pass", body);
});

test("equal-time and later unknown verdict prose require newer machine proof", () => {
  for (const closing of ["Swish!", "Do not merge.", "A vulnerability remains.", "Needs work."]) {
    const body = receipt.replace(":rocket:", closing);
    assert.notEqual(evaluate({ comments: [comment(body), comment(summary())] }), "pass", closing);
    assert.notEqual(evaluate({ comments: [comment(summary()), comment(body, { created_at: "2026-10-01T10:03:00Z" })] }), "pass", closing);
    assert.equal(evaluate({ comments: [comment(body), comment(summary().replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:03:00Z"), { created_at: "2026-10-01T10:03:00Z" })] }), "pass", closing);
  }
});

test("security-only summary edits cannot renew stale or missing code completion time", () => {
  const repeated = { ...marker, sourceCommentCreatedAt: "2026-10-01T10:03:00Z" };
  for (const body of [summary(), summary().replace(/ <relative-time[^>]+>[^<]+<\/relative-time>/, "")])
    assert.notEqual(evaluateCodexEvidence({ headSha, requestMarker: repeated, comments: [comment(body, { created_at: resultAt, updated_at: "2026-10-01T10:04:00Z" })] }), "pass", body);
  const fresh = summary().replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:04:00Z");
  assert.equal(evaluateCodexEvidence({ headSha, requestMarker: repeated, comments: [comment(fresh, { created_at: "2026-10-01T10:04:00Z" })] }), "pass");
});

test("security-only edits cannot reorder old code proof over an unknown receipt", () => {
  const edited = comment(summary(), { created_at: resultAt, updated_at: "2026-10-01T10:04:00Z" });
  const unknown = comment(receipt.replace(":rocket:", "Swish!"), { created_at: "2026-10-01T10:03:00Z" });
  assert.equal(evaluate({ comments: [edited, unknown] }), "pending");
  assert.notEqual(evaluate({ comments: [comment(summary().replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:05:00Z"))] }), "pass");
});

test("fractional completion times cannot outrun same-second receipts or requests", () => {
  const fractional = summary().replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:02:00.500Z");
  assert.equal(evaluate({ comments: [comment(fractional), comment(receipt.replace(":rocket:", "Swish!"))] }), "pending");
  assert.equal(evaluateCodexEvidence({ headSha, requestMarker: { ...marker, sourceCommentCreatedAt: resultAt }, comments: [comment(fractional)] }), "pending");
});


test("structured withdrawal recovery requires a new code completion, not a summary edit", () => {
  const removed = comment("Ordinary text", { prior_review_signal: true, prior_structured_summary: true,
    created_at: resultAt, updated_at: "2026-10-01T10:03:00Z" });
  const laterReceipt = comment(receipt, { created_at: "2026-10-01T10:04:00Z" });
  for (const fence of [withdrawal(), removed]) {
    for (const flags of [{}, { has_any_findings: null, has_unresolved_findings: null }]) {
      for (const completion of [resultAt, "2026-10-01T10:03:00.999Z"]) {
        const stale = comment(summary(state(flags)).replaceAll(resultAt, completion), {
          created_at: "2026-10-01T10:05:00Z", updated_at: "2026-10-01T10:05:00Z"
        });
        assert.equal(evaluate({ comments: [fence, laterReceipt, stale] }), "pending");
      }
      const fresh = comment(summary(state(flags)).replaceAll(resultAt, "2026-10-01T10:05:00Z"), {
        created_at: "2026-10-01T10:05:00Z", updated_at: "2026-10-01T10:05:00Z"
      });
      assert.equal(evaluate({ comments: [fence, laterReceipt, fresh] }), "pass");
    }
  }
});


test("actual gate dates unknown receipt edits by server observation", () => {
  const request = comment(createAiReviewRequestMarkerBody({ agent: "codex", headSha, requestId: "later", sourceCommentId: "20", requestedAt: "2026-10-01T10:02:00Z" }), { user: { login: "github-actions[bot]" }, created_at: "2026-10-01T10:02:01Z" });
  const clean = comment(summary().replaceAll(resultAt, "2026-10-01T10:04:00Z"), { created_at: "2026-10-01T10:04:00Z" });
  for (const [created, updated, expected] of [["10:01", "10:03", 0], ["10:03", "10:03", 0], ["10:01", "10:05", 1], ["10:01", "10:04", 1], ["10:05", "10:05", 1]]) {
    const unknown = comment(receipt.replace(":rocket:", "Swish!"), { created_at: `2026-10-01T${created}:00Z`, updated_at: `2026-10-01T${updated}:00Z` });
    const result = runGate({ deletedEvidence: true, extraComments: [request, unknown, clean] });
    assert.equal(result.status, expected, `${created}/${updated}: ${result.stderr}`);
  }
  const oldPositive = comment(receipt, { created_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:05:00Z" });
  assert.equal(runGate({ deletedEvidence: true, extraComments: [request, oldPositive] }).status, 1);
  assert.equal(runGate({ deletedEvidence: true, extraComments: [request, oldPositive, clean] }).status, 0);
});


test("actual gate requires section completion to retire historical typed findings", () => {
  const time = minute => `2026-10-01T10:0${minute}:00Z`;
  const marker = comment(createAiReviewRequestMarkerBody({ agent: "codex", headSha, requestId: "repeat", sourceCommentId: "20", requestedAt: time(3) }), { user: { login: "github-actions[bot]" }, created_at: time(3) });
  const render = (value, securityTime = null) => summary(value).replaceAll(resultAt, time(4)).replace("| 🛡️ **Security Review** | ✅ **Completed** |", `| 🛡️ **Security Review** | ✅ **Completed**${securityTime ? ` <relative-time datetime="${securityTime}">${securityTime}</relative-time>` : ""} |`);
  const negativeState = { ...state(), security_review: { ...state().code_review, has_any_findings: true, has_unresolved_findings: true } };
  const negative = comment(render(negativeState, time(2)), { created_at: time(1), updated_at: time(2) });
  const positive = comment(receipt, { created_at: time(5), updated_at: time(5) });
  const native = { databaseId: 90, author: { login: bot.login, __typename: "Bot" }, commit: { oid: headSha }, state: "APPROVED", body: "Approved.", submittedAt: time(5), updatedAt: time(5), lastEditedAt: null };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, negative, positive], reviews: [native] }).status, 1);
  const markerProse = { ...negative, body: negative.body + "\nThe codex-review-state: parser has a defect." };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, markerProse, positive], reviews: [native] }).status, 1, "ordinary marker prose cannot erase findings");
  const cleanState = { ...state(), security_review: { ...state().code_review } };
  for (const [value, securityTime, expected] of [[state(), null, 1], [cleanState, null, 1], [cleanState, time(2), 1], [cleanState, time(2).replace("00Z", "00.999Z"), 1], [cleanState, "2026-02-30T12:04:00Z", 1], [cleanState, "October 15, 2026 12:04:00 GMT", 1], [cleanState, time(4), 0]]) {
    const clean = comment(render(value, securityTime), { created_at: time(4), updated_at: time(4) });
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, negative, clean, positive], reviews: [native] }).status, expected);
  }
  const duplicateSection = { ...negative, body: render(cleanState, time(4)) + "\n| 🛡️ **Security Review** | 🔄 **Running** |", created_at: time(4), updated_at: time(4) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, negative, duplicateSection] }).status, 1, "duplicate affected section cannot clear findings");
  const clean = comment(render(state()), { created_at: time(4), updated_at: time(4) });
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, markerProse, clean, positive], reviews: [native] }).status, 1, "marker prose cannot erase historical security findings before code-only snapshot");
  for (const body of [negative.body.replaceAll(headSha, "b".repeat(40)), negative.body.replace('"has_any_findings":true', '"has_any_findings":true,"has_any_findings":true'), negative.body.replace(":v1", ":v2")])
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, { ...negative, body }, clean] }).status, 0);
  for (const section of ["code_review", "security_review"]) {
    const value = { ...state(), [section]: { ...state().code_review, has_any_findings: true, has_unresolved_findings: true } };
    const editedNegative = { ...negative, body: render(value, time(1)).replaceAll(time(4), time(1)), updated_at: time(5) };
    const fullClean = { ...negative, body: render(cleanState, time(4)), created_at: time(4), updated_at: time(4) };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, editedNegative, fullClean] }).status, 0, section + " other-section edit cannot renew old finding");
  }
  const mixedState = { ...negativeState, code_review: { ...negativeState.security_review } };
  const oldMixed = { ...negative, body: render(mixedState, time(3)).replaceAll(time(4), time(1)), updated_at: time(3) };
  const staggeredClean = { ...negative, body: render(cleanState, time(5)).replaceAll(time(4), time(4)), created_at: time(1), updated_at: time(5) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldMixed, staggeredClean] }).status, 0, "each clean section outruns its finding independently");
  for (const mode of ["row", "false-companion", "global", "malformed", "older-clear", "none", "old-receipt", "malformed-receipt", "running"]) {
    let observedBody = render(mode === "false-companion" ? { ...mixedState, security_review: { ...mixedState.security_review, has_any_findings: false, has_unresolved_findings: false } } : mixedState, time(6)).replaceAll(time(4), time(1)).replace(/(\| 🛡️[^\n]*\| )Manual request( \|)/, "$1P1 blocker$2");
    if (mode === "global") observedBody += "\nP1 blocker";
    if (mode === "malformed") observedBody = observedBody.replace(time(6) + "</relative-time>", time(5) + "</relative-time>");
    const observed = { ...negative, body: observedBody, updated_at: time(6) };
    const codeClear = { ...negative, body: render(state()), created_at: time(4), updated_at: time(4) };
    const clearTime = time(mode === "older-clear" ? 5 : 7);
    const securityClear = { ...negative, body: render(cleanState, clearTime).replaceAll(time(4), time(1)), created_at: clearTime, updated_at: clearTime };
    if (mode === "running") securityClear.body = securityClear.body.replaceAll('"status":"completed"', '"status":"running"');
    const current = { ...positive, body: mode === "malformed-receipt" ? receipt.replace(headSha.slice(0,10), "b".repeat(10)) : receipt, created_at: time(mode === "old-receipt" ? 2 : 8), updated_at: time(8) };
    const actual = runGate({ deletedEvidence: true, extraComments: [marker, observed, codeClear, securityClear, ...(mode === "none" ? [] : [current])], reviews: [native] });
    assert.equal(actual.status, mode === "row" ? 0 : 1, "section-scoped warning clock " + mode + "\n" + actual.stdout + actual.stderr);
    if (mode === "row") {
      const bothOld = { ...securityClear, body: render(cleanState, time(4)), created_at: time(7), updated_at: time(7) };
      const invalidHistorical = runGate({ deletedEvidence: true, extraComments: [marker, observed, codeClear, securityClear, bothOld, current], reviews: [native] });
      assert.equal(invalidHistorical.status, 1, "a newly created summary carrying only pre-creation clocks stays pending");
      const reverseCarry = { ...securityClear, body: render(cleanState, time(1)).replaceAll(time(4), time(7)) };
      assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, observed, codeClear, securityClear, reverseCarry, current], reviews: [native] }).status, 0, "fresh code completion may carry historical security structure after genuine clearance");
    }
  }
  const foreignCodeSecurity = { ...negative, body: render({ ...negativeState, code_review: { ...negativeState.code_review, commit_sha: oldSha } }, time(2)) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, foreignCodeSecurity, clean] }).status, 1, "current-head security findings survive foreign-head code state");
  for (const other of [{}, { status: "running" }, { commit_sha: "b".repeat(40) }]) {
    const historicalNegative = { ...negative, body: render(negativeState, time(1)).replaceAll(time(4), time(1)), created_at: time(1), updated_at: time(1) };
    let resolution = { ...negative, body: render({ ...cleanState, code_review: { ...cleanState.code_review, ...other } }, time(2)).replaceAll(time(4), time(2)).replace("| 📝 **Code Review** | ✅ **Completed**", other.status === "running" ? "| 📝 **Code Review** | 🔄 **Running**" : "| 📝 **Code Review** | ✅ **Completed**"), created_at: time(1), updated_at: time(2) };
    if (other.commit_sha) resolution.body = resolution.body.replace(/(\| 📝 \*\*Code Review\*\*[^\n]*`)[a-f0-9]{7}(`)/, "$1bbbbbbb$2");
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, historicalNegative, resolution, clean, positive], reviews: [native] }).status, 0, "historical section resolution survives repeated request and other-section progress");
  }
  const oldFinding = { ...negative, body: render(negativeState, time(1)).replaceAll(time(4), time(1)), created_at: time(1), updated_at: time(1) };
  const newlyObservedOldClock = { ...oldFinding, created_at: time(5), updated_at: time(5) };
  const interveningClear = { ...negative, body: render(cleanState, time(4)), created_at: time(1), updated_at: time(4) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, newlyObservedOldClock, interveningClear, positive], reviews: [native] }).status, 1, "a completion cannot predate its comment creation");
  const genuinelyNewClear = { ...interveningClear, body: render(cleanState, time(6)).replaceAll(time(4), time(6)), updated_at: time(6) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, newlyObservedOldClock, genuinelyNewClear, positive], reviews: [native] }).status, 0, "a genuinely newer section completion clears the observed finding");
  const malformedResolution = { ...negative, body: render(cleanState, time(2)).replaceAll(time(4), time(2)).replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*)/, "$1 Do not merge."), created_at: time(2), updated_at: time(2) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, malformedResolution, clean, positive], reviews: [native] }).status, 1, "fifth-column prose cannot supply canonical section resolution");
  const editedForeignNegative = { ...negative, body: render({ ...negativeState, code_review: { ...negativeState.code_review, commit_sha: "b".repeat(40) } }, time(1)).replaceAll(time(4), time(1)).replace(/(\| 📝 \*\*Code Review\*\*[^\n]*`)[a-f0-9]{7}(`)/, "$1bbbbbbb$2"), created_at: time(1), updated_at: time(5) };
  const historicalResolution = { ...negative, body: render(cleanState, time(2)).replaceAll(time(4), time(2)), created_at: time(2), updated_at: time(2) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, editedForeignNegative, historicalResolution, clean, positive], reviews: [native] }).status, 0, "resolved current-head security finding does not inherit foreign code-section edit clock");
  const wrongRowHead = { ...historicalResolution, body: historicalResolution.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*`)[a-f0-9]{7}(`)/, "$1bbbbbbb$2") };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, wrongRowHead, clean, positive], reviews: [native] }).status, 1, "affected row SHA must match current head");
  for (const status of ["running", "failed"]) {
    const activeNegative = { ...negative, body: render({ ...negativeState, security_review: { ...negativeState.security_review, status } }, time(1)), updated_at: time(5) };
    const laterClean = { ...negative, body: render(cleanState, time(4)), created_at: time(4), updated_at: time(4) };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, activeNegative, laterClean, positive], reviews: [native] }).status, 1, "noncompleted own status retains update clock despite old Completed row");
  }
  const companionState = { ...state(), code_review: { ...cleanState.code_review, has_any_findings: true, has_unresolved_findings: true }, security_review: { ...cleanState.security_review, commit_sha: "b".repeat(40) } };
  const companionNegative = { ...negative, body: render(companionState, time(1)).replaceAll(time(4), time(1)), created_at: time(1), updated_at: time(5) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, companionNegative, historicalResolution, clean, positive], reviews: [native] }).status, 1, "resolved finding cannot discard mismatched companion row");
  const validCompanionNegative = { ...companionNegative, body: companionNegative.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*`)[a-f0-9]{7}(`)/, "$1bbbbbbb$2") };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, validCompanionNegative, historicalResolution, clean, positive], reviews: [native] }).status, 0, "coherent foreign-head companion does not renew resolved finding");
  for (const foreignFlags of [false, true]) {
    const foreignState = { ...companionState, security_review: { ...companionState.security_review, has_any_findings: foreignFlags, has_unresolved_findings: foreignFlags } };
    const malformedCompanion = { ...companionNegative, body: render(foreignState, time(1)).replaceAll(time(4), time(1)) };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, malformedCompanion, historicalResolution, clean, positive], reviews: [native] }).status, 1, "foreign finding flags cannot hide malformed companion");
    const coherentCompanion = { ...malformedCompanion, body: malformedCompanion.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*`)[a-f0-9]{7}(`)/, "$1bbbbbbb$2") };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, coherentCompanion, historicalResolution, clean, positive], reviews: [native] }).status, 0);
  }
  for (const indent of ["    ", "\t"]) {
    const indentMarkers = body => body.replace(/^<!-- codex-/gm, indent + "<!-- codex-");
    const exampleFinding = { ...oldFinding, body: indentMarkers(oldFinding.body) };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, exampleFinding, clean, positive], reviews: [native] }).status, 0, "indented markers cannot latch historical findings");
    const exampleClear = { ...historicalResolution, body: indentMarkers(historicalResolution.body) };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, exampleClear, clean, positive], reviews: [native] }).status, 1, "indented markers cannot resolve findings");
    const exampleApproval = { ...negative, body: indentMarkers(render(cleanState, time(4))), created_at: time(4), updated_at: time(4) };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, exampleApproval] }).status, 1, "indented markers cannot approve");
  }
  const unknownProtocolClear = { ...historicalResolution, body: historicalResolution.body + "\n<!-- CODEX-unknown -->" };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, unknownProtocolClear, clean, positive], reviews: [native] }).status, 1, "unknown protocol HTML cannot clear historical finding");
  const uppercaseSignal = { ...negative, body: render(cleanState, time(4)).replaceAll("codex-", "CODEX-"), created_at: time(4), updated_at: time(5) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, uppercaseSignal, clean, positive], reviews: [native] }).status, 1, "uppercase protocol is observed as pending");
  const genuineWithExample = { ...oldFinding, body: oldFinding.body + "\n    <!-- codex-review-state:v1 example -->" };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, genuineWithExample, clean, positive], reviews: [native] }).status, 1, "later indented example cannot erase genuine finding");
  const dangerousCompanion = { ...historicalResolution, body: historicalResolution.body.replace(/\| 📝 \*\*Code Review\*\*[^\n]*/, "| 📝 **Code Review** | ⚠️ Do not merge | `" + headSha.slice(0,7) + "` | Manual request |") };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, dangerousCompanion, clean, positive], reviews: [native] }).status, 1, "projection cannot erase companion row verdict");
  const codeFindingOnly = { ...negative, body: render({ ...state(), code_review: { ...cleanState.code_review, has_any_findings: true, has_unresolved_findings: true } }).replaceAll(time(4), time(1)), created_at: time(1), updated_at: time(5) };
  const hiddenNullRow = { ...codeFindingOnly, body: codeFindingOnly.body + "\n    | 🛡️ **Security Review** | ⚠️ Do not merge |" };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, hiddenNullRow, historicalResolution, clean, positive], reviews: [native] }).status, 1, "inactive section label cannot hide behind indentation");
  for (const companion of ["🛡️ **Security Review** | ✅ **Completed** |", "<details><summary>ℹ️ About Codex in GitHub</summary>information</details>\n| 🛡️ **Security Review** | ⚠️ Failed |\n</details>", "<details><summary>ℹ️ About Codex in GitHub</summary>\n> | 🛡️ **Security&#32;Review** | ✅ **Completed** |\n</details>"]) {
    const ambiguousNull = { ...codeFindingOnly, body: codeFindingOnly.body + "\n" + companion };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, ambiguousNull, historicalResolution, clean, positive], reviews: [native] }).status, 1, "rendered inactive companion contradicts null state independent of container");
  }
  for (const label of ["Security&#32;Review", "Security&nbsp;Review", "Security<strong> </strong>Review", "SECURITY REVIEW"]) {
    const renderedNull = { ...hiddenNullRow, body: hiddenNullRow.body.replace("**Security Review**", "**" + label + "**").replace("⚠️ Do not merge", "Completed") };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, renderedNull, historicalResolution, clean, positive], reviews: [native] }).status, 1, "rendered inactive companion label keeps observed edit authority");
  }
  for (const whitespace of [" ", "\n", "   "]) {
    const normalizedResolution = { ...historicalResolution, body: whitespace + historicalResolution.body };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, normalizedResolution, clean, positive], reviews: [native] }).status, 0, "accepted envelope whitespace remains valid resolution");
  }
  const foreignResolutionState = { ...cleanState, code_review: { ...cleanState.code_review, commit_sha: "b".repeat(40) } };
  const mismatchedResolution = { ...historicalResolution, body: render(foreignResolutionState, time(2)).replaceAll(time(4), time(2)) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, mismatchedResolution, clean, positive], reviews: [native] }).status, 1, "historical clearing requires coherent companion SHA");
  const genuineWithFencedExample = { ...oldFinding, body: oldFinding.body + "\n```html\n<!-- codex-review-state:v1 example -->\n```" };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, genuineWithFencedExample, clean, positive], reviews: [native] }).status, 1, "later fenced example cannot erase genuine finding");
  for (const indent of ["    ", "\t"]) {
    const bomExample = { ...negative, body: "\uFEFF" + render(cleanState, time(4)).replace(/^<!-- codex-/gm, indent + "<!-- codex-"), created_at: time(4), updated_at: time(4) };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, bomExample] }).status, 1, "BOM cannot normalize indented protocol example into authority");
  }
  const runningStateCompletedRow = { ...historicalResolution, body: render({ ...cleanState, code_review: { ...cleanState.code_review, status: "running" } }, time(2)).replaceAll(time(4), time(2)) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, runningStateCompletedRow, clean, positive], reviews: [native] }).status, 1, "running typed companion requires Running rendering");
  for (const indent of ["    ", "\t"]) {
    const indentedTodoClear = { ...historicalResolution, body: historicalResolution.body + "\n" + indent + "<!-- TODO -->" };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, indentedTodoClear, clean, positive], reviews: [native] }).status, 1, "indented nonprotocol HTML cannot normalize into history clearance");
  }
  for (const trailing of ["\n> ```html\n> <!-- codex-review-state:v1 {} -->\n> ```", "\n<!-- codex-review-state:v1 {} -->"]) {
  const genuineWithQuotedFence = { ...oldFinding, body: oldFinding.body + trailing };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, genuineWithQuotedFence, clean, positive], reviews: [native] }).status, 1, "nested blockquote fenced example cannot erase genuine finding");
  }
  const fullyClean = { ...negative, body: render(cleanState, time(4)), created_at: time(4), updated_at: time(4) };
  const lateVisibleNegative = { ...oldFinding, body: oldFinding.body + "\nP1: Security review failed.", updated_at: time(6) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, lateVisibleNegative, fullyClean, positive], reviews: [native] }).status, 1, "visible negative edit uses observation clock");
  const lateFoundNegative = { ...oldFinding, body: oldFinding.body + "\nFound an issue", updated_at: time(6) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, lateFoundNegative, fullyClean, positive], reviews: [native] }).status, 1, "singular finding article keeps observed edit time");
  const lateHtmlFoundNegative = { ...oldFinding, body: oldFinding.body + "\nFound <em>an</em> issue", updated_at: time(6) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, lateHtmlFoundNegative, fullyClean, positive], reviews: [native] }).status, 1, "rendered finding article keeps observed edit time");
  const lateWordedFoundNegative = { ...oldFinding, body: oldFinding.body + "\nFound one issue", updated_at: time(6) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, lateWordedFoundNegative, fullyClean, positive], reviews: [native] }).status, 1, "worded finding count keeps observed edit time");
  for (const statement of ["Users can bypass authentication.", "The application is vulnerable to SQL injection.", "Authentication can be bypassed.", "I see a bug.", "We identify an issue.", "This change introduces multiple bugs.", "This change contains some issues.", "This change has several regressions.", "This change prevents a bug that remains.", "This change causes a security issue.", "This change exposes a security issue.", "A security risk remains.", "A bug must be fixed.", "A bug should be fixed.", "The security issue does not exist locally but remains in production.", "A security issue is already fixed in tests but exploitable in production.", "The issue does not remain fixed.", "No issues were found except one already fixed that has reappeared.", "This change introduces a bug.", "This change creates a bug.", "This change contains a bug.", "This change has a bug.", "A resolved issue reopened.", "Most issues remain.", "Every issue remains.", "Numerous issues remain.", "An eliminated issue reappeared.", "An eliminated issue has reappeared.", "A resolved issue has reappeared.", "A fixed bug recurred.", "The security issue is harmless in tests but exploitable in production.", "Critical security issue remains.", "Authentication vulnerability exists.", "A defect exists.", "This is a defect.", "No findings are pending; Security review failed.", "No findings are pending but 1 issue is unresolved.", "A defect remains.", "A regression remains.", "One issue persists.", "We have one security issue.", "Both issues remain.", "Many issues remain.", "All issues remain unresolved.", "A security issue<br>was found.", "No issues were found except two.", "An eliminated issue may reappear.", "A resolved issue could recur.", "The bug still exists.", "There still is a bug.", "A flaw was detected.", "Two security issues were found.", "The issue allows code execution.", "An issue can expose secrets.", "The vulnerability is exploitable.", "No issues or findings were found\u2014except one.", "An eliminated issue was found again.", "This eliminated issue persists.", "No<center>An issue remains</center>", "This is an issue.", "That is a bug.", "A bug is present", "A problem persists", "An issue is outstanding", "A security issue got flagged.", "No code changes were needed and one security issue remains.", "This issue is not resolved.", "Issues persist.", "Findings are outstanding.", "A security issue has gotten flagged.", "A security issue had gotten flagged.", "Security issue: authentication bypass.", "A security issue: was flagged.", "A vulnerability was detected.", "Security issue: no authentication on endpoint.", "Security issue: no workaround.", "Security issue—authentication bypass."]) {
    const footerNegative = { ...oldFinding, body: oldFinding.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>" + statement + "\n</details>", updated_at: time(6) };
    if (["No<center>An issue remains</center>", "This is an issue.", "That is a bug."].includes(statement)) {
      const freshNominal = { ...fullyClean, body: fullyClean.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>" + statement + "\n</details>" };
      assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, freshNominal, positive], reviews: [native] }).status, 1, "fresh clean summary cannot hide nominal finding");
    }
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, footerNegative, fullyClean, positive], reviews: [native] }).status, 1, "appended About finding retains observation clock: " + statement);
    if (["A defect remains.", "A regression remains.", "No<center>An issue remains</center>", "A security issue got flagged.", "This is an issue.", "That is a bug."].includes(statement)) {
      const recovery = { ...fullyClean, body: render(cleanState, time(7)), created_at: time(1), updated_at: time(7) };
      assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, footerNegative, recovery, positive], reviews: [native] }).status, 0, "new canonical clear retires got-passive warning");
    }
  }
  const lateBugNegative = { ...oldFinding, body: oldFinding.body + "\nThere is a bug.", updated_at: time(6) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, lateBugNegative, fullyClean, positive], reviews: [native] }).status, 1, "explicit bug edit keeps observed time");
  const bugRecovery = { ...fullyClean, body: render(cleanState, time(7)), created_at: time(1), updated_at: time(7) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, lateBugNegative, bugRecovery, positive], reviews: [native] }).status, 0, "genuinely newer canonical clear resolves bug edit");
  for (const benign of ["The review mentioned a bug fix.", "We discussed a bug.", "The application is not vulnerable to SQL injection.", "Authentication cannot be bypassed.", "We prevent a bug.", "I fix an issue.", "This change prevents a bug.", "This change mitigates an issue.", "This change avoids a regression.", "This change fixes a security issue.", "No security risks remain.", "A generic risk remains.", "Fixed one issue.", "Regression tests passed.", "One regression test passed.", "One defect report was closed.", "Issues do not exist.", "Bugs do not remain.", "No issues were found except one already fixed.", "No findings are pending.", "No issues remain unresolved.", "Security issues: none were found.", "Security issues: none are outstanding.", "Security issue: none currently exist.", "No issues were found except one, which was fixed.", "An eliminated issue was documented.", "The issue is harmless.", "The issue is benign.", "Found 1 fixed issue.","Security issues: none found.", "Security issue: none exist.", "Security issues: zero outstanding.", "No<caption>An issue remains</caption>", "No<legend>An issue remains</legend>", "Found <em>no</em> issues", "Do&nbsp not&nbsp merge", "<!-- P1 blocker -->", "There is no bug.", "Found issues: zero", "Issues found: zero", "No security issues found", "[safe]: P1", "The word issues is emphasized.", "The words security issues are documented below", "The words security issues: documented below.", "A security issue got eliminated.", "No code or security issues were found.", "No issues or findings were found.", "There is an issue that was resolved", "This is not an issue.", "This is no longer an issue.", "This is not considered a bug.", "This isn't a bug.", "This is a bug-free change", "P_1 is not a priority token", "P*1", "paragraph\n<span>\n[safe](P1)", "[safe]: /url\n  \"title [^note]\"\n[^note]: P1", "There is not a bug.", "Found\n\nan issue.", "Found <code>0</code> issues", "[^doc]: P1", "[safe](https://example.test/[^note])\n\n[^note]: P1 example", "[safe]: https://example.test/[^note]\n[^note]: P1 example", "[^bad label]: P1", "note[^bad label]\n\n[^bad label]: P1", "[^doc]: safe\n  P1", "[^doc]: safe\n    P1", "<details><summary>ℹ️ About Codex in GitHub</summary>\n\n[^doc]: safe\n  P1\n</details>", "<details><summary>ℹ️ About Codex in GitHub</summary>\n\n[^doc]: safe\n    P1\n</details>", "> <div>\n[safe](P1)", "- <div>\n\n[safe](P1)", "<div>\n<img / P1>\n</div>", "<div>\n</span P1>\n</div>", "[safe](" + "(".repeat(32) + "P1" + ")".repeat(32) + ")"]) {
    const noFindingsEdit = { ...oldFinding, body: oldFinding.body + "\n" + benign, updated_at: time(6) };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, noFindingsEdit, fullyClean, positive], reviews: [native] }).status, 0, "rendered no findings does not renew old negative: " + benign);
  }
  const footerNegative = { ...oldFinding, body: oldFinding.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>P1 remains.</details>", updated_at: time(6) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, footerNegative, fullyClean, positive], reviews: [native] }).status, 1, "visible About-footer finding uses observed edit time");

  const warningLabel = { ...oldFinding, body: oldFinding.body.replace("| 🛡️ **Security Review** |", "| ⚠️ P1 🛡️ **Security Review** |"), updated_at: time(6) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, warningLabel, fullyClean, positive], reviews: [native] }).status, 1, "warning-bearing own row cannot borrow old completion clock");
  const malformedStatusState = { ...negativeState, security_review: { ...negativeState.security_review, status: "<!-- codex-review-state:" } };
  const malformedStatus = { ...oldFinding, body: render(malformedStatusState, time(1)).replaceAll(time(4), time(1)) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, malformedStatus, clean, positive], reviews: [native] }).status, 0, "duplicate protocol inside envelope is not durable authority");
  const fencedResolution = { ...historicalResolution, body: historicalResolution.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*)/, "```markdown\n$1\n````") };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, fencedResolution, clean, positive], reviews: [native] }).status, 1, "fenced completed row cannot clear findings");
  for (const indent of ["    ", "\t", "\uFEFF    ", "<!-- presentation metadata -->    "]) {
    const codeHeadingClear = { ...historicalResolution, body: historicalResolution.body.replace("## Codex Review Summary", indent + "## Codex Review Summary") };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, codeHeadingClear, clean, positive], reviews: [native] }).status, 1, "indented code heading cannot clear findings");
  }
  const pipeCommentClear = { ...historicalResolution, body: historicalResolution.body.replaceAll("Manual request", "Manual <!-- | --> request") };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, pipeCommentClear, clean, positive], reviews: [native] }).status, 1, "raw table delimiters cannot vanish in comments");
  const escapedTickClear = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>\n\n" + "\\`[safe](P1)\\`" + "\n</details>" };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, escapedTickClear, clean, positive], reviews: [native] }).status, 0, "escaped opening backticks leave active link destination hidden");
  const safeReferenceClear = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>\n\n[safe][doc]\n[doc]: https://example.test/P1\n</details>" };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, safeReferenceClear, clean, positive], reviews: [native] }).status, 0, "recognized reference definition destination is hidden");
  for (const tag of ["script", "style"]) {
    const rawDetailsClear = { ...historicalResolution, body: historicalResolution.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*)/, "<details>\n<" + tag + ">\n</details>\n</" + tag + ">\n$1\n</details>") };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, rawDetailsClear, clean, positive], reviews: [native] }).status, 1, "raw text details closer cannot grant row authority");
  }
  for (const literal of ["<span>P&#49</span> blocker", "`P&#49` blocker"]) {
    const markdownNumericClear = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>\n\n" + literal + "\n</details>" };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, markdownNumericClear, clean, positive], reviews: [native] }).status, 0, "semicolonless numeric text stays literal outside raw HTML blocks");
  }
  const afterVisibleClear = { ...fullyClean, body: fullyClean.body.replaceAll(time(4), time(7)), created_at: time(7), updated_at: time(7) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, lateVisibleNegative, afterVisibleClear, positive], reviews: [native] }).status, 0, "newer strict same-section completion clears earlier visible finding");
  for (const warning of ["P&#49; blocker", "P&#x31; blocker", "P*1* blocker", "Do&#32;not&#32;merge", "Do&MediumSpace;not&MediumSpace;merge", "Do&hairsp;not&hairsp;merge", "P<strong>1</strong> blocker", "Do <em>not</em> merge", "Do [not](https://example.com) merge", "Do [not]( https://example.com ) merge", "Do [not]() merge", "P&#8203;1 blocker", "P\uFE0F1 blocker", "[safe](P1>)", "Do [not] merge\n[not]:\n  https://example.com", "\n> ~~~\n> [safe](P1)\n> ~~~", "`<P1> blocker`", "```\n<P1> blocker\n```", "\n\n    [safe](P1)", "\n\n\t[safe](P1)", "[safe [inner](url)](P1)", "<P1?> blocker", "[safe\\]( P1)", "`[safe](P1)`", "```\n[safe](P1)\n```", "<code>[safe](P1)</code>", "\\[safe](P1)", "[safe\n\nlabel](P1)", "Do [not\n](https://example.com) merge", "Do<br>not<br>merge", "P`1` blocker", "Do `not` merge", "[foo[bar]: https://example.test/P1", "[doc]: P1)", "<div>\n[safe](P1)\n</div>", "<div>\n[P1]: https://example.test\n</div>", "Found\nan issue.", "<div>\nP&#49 blocker\n</div>", "<div>\nDo&#32not&#32merge\n</div>", "Found issues.", "Found an issue", "Found one issue", "There is an issue.", "There is 1 issue", "Detected 1 issue", "Detected an issue.", "1 bug is not fixed", "There is an issue that was not resolved", "This is not safe because there is a bug.", "Found 1,000 issues.", "One security issue was identified", "Multiple security issues remain", "Found 1 issue: zero", "A bug is present", "A problem persists", "An issue is outstanding", "No code issues: 1 security issue found", "Found an issue that is not yet resolved.", "Not clean: one bug remains.", "This is not resolved: a bug remains.", "\n\n    safe\n<span>\n[safe](P1)", "> safe\n<span>\n[safe](P1)", "- safe\n<span>\n[safe](P1)", "There is a bug.", "Bug found.", "One issue found.", "Multiple findings remain.", "An issue was detected.", "Several issues were detected.", "Some problems remain.", "paragraph\n\n<span>\n[safe](P1)", "<!-->P1 blocker", "<!--->P1 blocker", "<div>Do&nbsp not&nbsp merge</div>", "note[^SS]\n\n[^ß]: P1 blocker", "1 unresolved finding", "1 security issue found", "note[^DOC]\n\n[^doc]: P1", "note[^doc]\n\n[^doc]: safe\n  P1", "note[^doc]\n\n[^doc]: safe\n    P1", "root[^a]\n\n[^a]: safe [^b]\n[^b]: P1", "[^bad label]: P1 blocker", "<img / P1>", "<img =P1>", "<span P1?>safe</span>", "note[^doc]\n\n[^doc]: P1", "[safe][^doc]\n\n[^doc]: P1", "[safe](" + "(".repeat(33) + "P1" + ")".repeat(33) + ")", "</span P1>", "Found 0 code issues and 1 security issue", "-  <div>\n \t[safe](P1)\n</div>", "- > <div>\n  > [safe](P1)\n  > </div>", "> - <div>\n>   [safe](P1)\n>   </div>", "> <div>\n> [safe](P1)\n> </div>", "- <div>\n  [safe](P1)\n  </div>", "Security review failed.", "Review pending.", "Changes requested.", "[safe](P1\\ blocker)", "<!--[x](foo-->P1)", "[safe][P1 blocker]", 'Do [not](https://example.com "title") merge', "Do [not](https://example.com 'title') merge", "Do [not](https://example.com (title)) merge", 'Do <span title="&#34;>">not</span> merge', "Do [not][] merge\n[not]: https://example.com", "Do [not] merge\n[not]: https://example.com", '<img src="invalid" alt="P1 blocker">', "[safe](P1 blocker)", "Do [not][x] merge\n[x]: https://example.com", 'Do <span title=">">not</span> merge', "Do [not](https://example.com/(x)) merge", "Found **1** issue", "Found &#49; issue", "P<!--hidden-->1 blocker", "Do <!--hidden-->not merge", "Do&#8203;not&#8203;merge", "Do&ZeroWidthSpace;not&ZeroWidthSpace;merge", "Do&ThinSpace;not&ThinSpace;merge"]) {
    const renderedWarning = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>\n\n" + warning + "\n</details>" };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, renderedWarning, clean, positive], reviews: [native] }).status, 1, "rendered warning cannot clear findings");
  }
  for (const indent of [" ", "  ", "   "]) {
    const duplicateIndentedRow = { ...historicalResolution, body: historicalResolution.body + "\n" + indent + "| 🛡️ **Security Review** | ✅ **Completed** <relative-time datetime=\"" + time(2) + "\">" + time(2) + "</relative-time> | `bbbbbbb` | Manual request |" };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, duplicateIndentedRow, clean, positive], reviews: [native] }).status, 1, "accepted row indentation cannot hide duplicate section");
  }
  const commentedNegativeRow = { ...oldFinding, body: oldFinding.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*)/, "<!--\n$1\n-->"), updated_at: time(6) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, commentedNegativeRow, fullyClean, positive], reviews: [native] }).status, 1, "HTML-comment row cannot backdate a negative edit");
  const unterminatedCommentClear = { ...historicalResolution, body: historicalResolution.body.replace("| 🛡️ **Security Review** |", "<!--\n| 🛡️ **Security Review** |") };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, unterminatedCommentClear, clean, positive], reviews: [native] }).status, 1, "unterminated HTML comment cannot supply section completion");
  const splitRowClear = { ...historicalResolution, body: historicalResolution.body.replaceAll("✅ **Completed** <relative-time", "✅ **Completed** <!--\nmetadata\n--> <relative-time") };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, splitRowClear, clean, positive], reviews: [native] }).status, 1, "comment removal cannot join split rows into completion proof");
  const collapsedRowClear = { ...historicalResolution, body: historicalResolution.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*)/, "<details><summary>ℹ️ About Codex in GitHub</summary>\n$1\n</details>") };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, collapsedRowClear, clean, positive], reviews: [native] }).status, 1, "collapsed help details cannot supply section completion");
  const securityRow = historicalResolution.body.match(/^\| 🛡️[^\n]*$/m)[0];
  const nestedHiddenClear = { ...historicalResolution, body: historicalResolution.body.replace(securityRow, "<details><summary>outer</summary><details><summary>inner</summary></details>\n" + securityRow + "\n</details>") };
  const commentedFenceClear = { ...historicalResolution, body: historicalResolution.body + "\n<!--\n```\n-->\n" + securityRow };
  const visibleSummaryClear = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>\n" + securityRow.replace(/`[a-f0-9]+`/, "`bbbbbbb`") + "\n</summary></details>" };
  const renderedDuplicateClear = { ...historicalResolution, body: historicalResolution.body + "\n" + securityRow.replace("Security Review", "Security&#32;Review").replace(/`[a-f0-9]+`/, "`bbbbbbb`") };
  const linkedDuplicateClear = { ...historicalResolution, body: historicalResolution.body + "\n" + securityRow.replace("Security Review", "[Security](https://example.test) Review").replace(/`[a-f0-9]+`/, "`bbbbbbb`") };
  const malformedCommentDuplicate = { ...historicalResolution, body: historicalResolution.body + "\n| 🛡️ **<!--[x](foo-->Security Review<!--bar)** | fake |" };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, malformedCommentDuplicate, clean, positive], reviews: [native] }).status, 1, "a visible duplicate label remains ambiguous without its final delimiter");
  for (const example of ["`<summary>Security Review</summary>`", "```html\n<summary>Security Review</summary>\n``` "]) {
    const literalSummaryClear = { ...historicalResolution, body: historicalResolution.body + "\n" + example };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, literalSummaryClear, clean, positive], reviews: [native] }).status, 0, "literal summary example is not active HTML counterevidence");
  }
  const duplicateAfterAbout = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>\ninformation\n</details>\n" + securityRow };
  const unmatchedCloserClear = { ...historicalResolution, body: historicalResolution.body.replace(securityRow, "<details>\n</pre>\n" + securityRow + "\n</details>") };
  const rawBlockClears = ["pre", "code", "div", "script", "style", "textarea", "table", "section", "article", "blockquote", "kbd"].map(tag => ({ ...historicalResolution, body: historicalResolution.body.replace(securityRow, "<" + tag + ">\n" + securityRow + "\n</" + tag + ">") }));
  for (const tag of ["pre", "code", "div", "script", "style", "textarea", "table", "section", "article", "blockquote", "kbd"]) {
    const rawBlockNegative = { ...oldFinding, body: oldFinding.body.replace(/^(\| 🛡️[^\n]*)/m, "<" + tag + ">\n$1\n</" + tag + ">"), updated_at: time(6) };
    assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, rawBlockNegative, fullyClean, positive], reviews: [native] }).status, 1, "raw-block negative retains updated observation clock");
  }
  for (const invalidClear of [nestedHiddenClear, commentedFenceClear, visibleSummaryClear, renderedDuplicateClear, linkedDuplicateClear, duplicateAfterAbout, unmatchedCloserClear, ...rawBlockClears]) assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, invalidClear, clean, positive], reviews: [native] }).status, 1, "hidden containers cannot synthesize unique completion proof");
  const bomMarkerClear = { ...historicalResolution, body: historicalResolution.body.replace(/^<!-- codex-pull-request-review-summary/, "    \uFEFF<!-- codex-pull-request-review-summary") };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, bomMarkerClear, clean, positive], reviews: [native] }).status, 1, "BOM between indentation and marker cannot create authority");
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, oldFinding, { ...bomMarkerClear, body: bomMarkerClear.body.replace("\uFEFF", "\u00A0") }, clean, positive], reviews: [native] }).status, 1, "NBSP between indentation and marker cannot create authority");
  const codeNegative = { ...negative, body: render(state({ has_any_findings: true, has_unresolved_findings: true })) };
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, codeNegative, positive], reviews: [native] }).status, 1);
  assert.equal(runGate({ deletedEvidence: true, extraComments: [marker, codeNegative, clean] }).status, 0);
});
