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
  isAcceptableCodexSummaryComment
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
const summary = (value = state()) => `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify(value)} -->\n\n## Codex Review Summary\n\nCompleted`;
const evaluate = (extra) => evaluateCodexEvidence({ headSha, requestMarker: marker, ...extra });

test("native receipt and legacy no-findings preserve explicit head binding", () => {
  for (const body of [receipt, receipt + "\n<details><summary>About Codex in GitHub</summary>Help</details>", receipt.split("\n\n").slice(1).join("\n\n")]) {
    assert.equal(isAcceptableCodexSummaryComment(comment(body), headSha, marker), true);
  }
  assert.equal(evaluate({ comments: [comment(receipt)] }), "pass");
  assert.equal(evaluate({ comments: [comment("Codex Review: Didn't find any major issues.")] }), "pass");
  assert.equal(evaluate({ comments: [comment("Codex Review: Didn't find any major issues.")], timeline: [{ event: "committed", created_at: "2026-10-01T10:01:00Z" }] }), "pending");
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
  const help = "<details><summary>About Codex</summary>Codex reacts while a review is running.</details>";
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
  assert.equal(evaluate({ reviews: [{ id: 1, user: bot, commit_id: headSha, state: "APPROVED", submitted_at: resultAt }] }), "pass");
  assert.equal(evaluate({ comments: [comment(receipt)], reviews: [{ ...reviews[0], submitted_at: resultAt }] }), "fail", "failure wins a timestamp tie");
});

function runGate({ body = receipt, heads = [headSha], threads = [], reviews = [], extraComments = [], historyNodes = {}, reviewPageInfo = { hasNextPage: false }, graphErrors = null }) {
  const dir = mkdtempSync(join(tmpdir(), "native-review-gate-"));
  try {
    const markerBody = createAiReviewRequestMarkerBody({ agent: "codex", headSha, requestId: "1", sourceCommentId: "1", sourceCommentCreatedAt: triggerAt, requestedAt: triggerAt });
    const fixture = { heads, threads, reviews, historyNodes, reviewPageInfo, graphErrors, comments: [comment(markerBody, { user: { login: "github-actions[bot]" } }), comment(body), ...extraComments] };
    const preload = join(dir, "fetch.mjs");
    writeFileSync(preload, `const fixture = ${JSON.stringify(fixture)}; let headRead = 0;
      globalThis.fetch = async (url, options = {}) => {
        let data;
        if (url.endsWith('/graphql') && JSON.parse(options.body).query.includes('userContentEdits')) { const variables = JSON.parse(options.body).variables; const nodes = fixture.historyNodes[variables.id]; data = { data: { node: Array.isArray(nodes) ? nodes[variables.cursor ? 1 : 0] : nodes } }; }
        else if (url.endsWith('/graphql')) data = { errors: fixture.graphErrors, data: { repository: { pullRequest: { reviews: { nodes: fixture.reviews, pageInfo: fixture.reviewPageInfo }, reviewThreads: { nodes: fixture.threads, pageInfo: { hasNextPage: false } } } } } };
        else if (/\\/pulls\\/1$/.test(url)) data = { head: { sha: fixture.heads[Math.min(headRead++, fixture.heads.length - 1)] } };
        else if (url.includes('/issues/1/comments')) data = fixture.comments;
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
  const raced = runGate({ heads: [headSha, oldSha] });
  assert.equal(raced.status, 1);
  assert.match(raced.stderr, /stale result/);
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
  const oldApproval = { user: bot, commit_id: headSha, state: "APPROVED", submitted_at: "2026-10-01T09:59:00Z", updated_at: "2026-10-01T10:03:00Z" };
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
    assert.equal(evaluate({ reviews: [review] }), "pending");
    assert.equal(evaluate({ comments: [comment(receipt)], reviews: [review] }), "pending");
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
      body: "Completed\n<details><summary>About Codex in GitHub</summary>Help: the app reacts while reviews are running.</details>" };
    assert.equal(evaluate({ reviews: [help] }), "pass");
  }
});
