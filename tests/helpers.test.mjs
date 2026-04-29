import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCodexNativeReview,
  containsBlockingSeverity,
  extractCodexPriority,
  extractClaudeOutcome,
  extractMarkerSha,
  isAcceptableClaudeComment,
  isAcceptableCodexSummaryComment,
  isAcceptableNativeReview,
  isTrustedReviewLogin,
  isTrustedAssociation
} from "../scripts/ai-review-helpers.mjs";
import { findRepoRoot } from "../scripts/shared.mjs";

test("trusted actor associations are explicit", () => {
  assert.equal(isTrustedAssociation("OWNER"), true);
  assert.equal(isTrustedAssociation("MEMBER"), true);
  assert.equal(isTrustedAssociation("COLLABORATOR"), true);
  assert.equal(isTrustedAssociation("CONTRIBUTOR"), false);
});

test("Claude review markers are parsed", () => {
  const body = [
    "AI_REVIEW_AGENT: claude",
    "AI_REVIEW_SHA: abc1234",
    "AI_REVIEW_OUTCOME: pass"
  ].join("\n");

  assert.equal(extractMarkerSha(body), "abc1234");
  assert.equal(extractClaudeOutcome(body), "pass");
});

test("blocking severity is backend aware", () => {
  assert.equal(containsBlockingSeverity("Found P1 issue", "codex"), true);
  assert.equal(containsBlockingSeverity("Found P3 issue", "codex"), false);
  assert.equal(extractCodexPriority("Found P2 issue"), 2);
  assert.equal(extractCodexPriority("No priority marker"), null);
  assert.equal(containsBlockingSeverity("Critical bug", "gemini"), true);
  assert.equal(containsBlockingSeverity("Medium note", "gemini"), false);
});

test("native Codex review must be approved and current-head", () => {
  assert.equal(
    isAcceptableNativeReview(
      {
        commit_id: "abc",
        state: "APPROVED",
        body: "Looks good",
        user: { login: "chatgpt-codex-connector[bot]" }
      },
      "codex",
      "abc"
    ),
    true
  );

  assert.equal(
    isAcceptableNativeReview(
      {
        commit_id: "old",
        state: "APPROVED",
        body: "Looks good",
        user: { login: "codex-reviewer[bot]" }
      },
      "codex",
      "abc"
    ),
    false
  );
});

test("Codex no-findings summary comment is accepted from trusted bot only", () => {
  assert.equal(
    isAcceptableCodexSummaryComment({
      body: "Codex Review: Didn't find any major issues for abc123def4. Nice work!",
      user: { login: "chatgpt-codex-connector[bot]" }
    }, "abc123def456"),
    true
  );

  assert.equal(
    isAcceptableCodexSummaryComment({
      body: "Codex Review: Found a P1 issue.",
      user: { login: "chatgpt-codex-connector[bot]" }
    }, "abc123def456"),
    false
  );

  assert.equal(
    isAcceptableCodexSummaryComment({
      body: "Codex Review: Didn't find any major issues.",
      user: { login: "chatgpt-codex-connector[bot]" }
    }, "abc123def456"),
    false
  );

  assert.equal(
    isAcceptableCodexSummaryComment({
      body: "Codex Review: Didn't find any major issues.",
      user: { login: "codex-fan-99" }
    }, "abc123def456"),
    false
  );
});

test("Codex commented reviews are classified by inline priorities", () => {
  const review = {
    id: 123,
    commit_id: "abc",
    state: "COMMENTED",
    user: { login: "chatgpt-codex-connector[bot]" }
  };

  assert.equal(classifyCodexNativeReview(review, [], "abc"), "pass");
  assert.equal(classifyCodexNativeReview(review, [
    {
      pull_request_review_id: 123,
      body: "![P3 Badge] advisory",
      user: { login: "chatgpt-codex-connector[bot]" }
    }
  ], "abc"), "pass");
  assert.equal(classifyCodexNativeReview(review, [
    {
      pull_request_review_id: 123,
      body: "![P1 Badge] blocker",
      user: { login: "chatgpt-codex-connector[bot]" }
    }
  ], "abc"), "fail");
  assert.equal(classifyCodexNativeReview(review, [
    {
      pull_request_review_id: 123,
      body: "untagged finding",
      user: { login: "chatgpt-codex-connector[bot]" }
    }
  ], "abc"), "fail");
  assert.equal(classifyCodexNativeReview({
    ...review,
    state: "APPROVED",
    body: "Contains P1"
  }, [], "abc"), "fail");
  assert.equal(classifyCodexNativeReview(review, [
    {
      pull_request_review_id: 123,
      body: "thanks",
      user: { login: "repo-owner" }
    },
    {
      pull_request_review_id: 123,
      body: "![P3 Badge] advisory",
      user: { login: "chatgpt-codex-connector[bot]" }
    }
  ], "abc"), "pass");
  assert.equal(classifyCodexNativeReview(review, [], "new-head"), null);
});

test("review bot logins require exact trusted matches", () => {
  assert.equal(isTrustedReviewLogin("chatgpt-codex-connector[bot]", "codex"), true);
  assert.equal(isTrustedReviewLogin("codex-fan-99", "codex"), false);

  assert.equal(
    isAcceptableNativeReview(
      {
        commit_id: "abc",
        state: "APPROVED",
        body: "Looks good",
        user: { login: "codex-fan-99" }
      },
      "codex",
      "abc"
    ),
    false
  );

  assert.equal(
    isAcceptableNativeReview(
      {
        commit_id: "abc",
        state: "APPROVED",
        body: "Looks good",
        user: { login: "custom-codex-review[bot]" }
      },
      "codex",
      "abc",
      { trustedReviewLoginsByAgent: { codex: ["custom-codex-review[bot]"] } }
    ),
    true
  );
});

test("Claude comments must contain pass for the current head SHA", () => {
  assert.equal(
    isAcceptableClaudeComment(
      {
        body: "AI_REVIEW_AGENT: claude\nAI_REVIEW_SHA: abc1234\nAI_REVIEW_OUTCOME: pass",
        user: { login: "claude[bot]" }
      },
      "abc1234"
    ),
    true
  );

  assert.equal(
    isAcceptableClaudeComment(
      {
        body: "AI_REVIEW_AGENT: claude\nAI_REVIEW_SHA: abc1234\nAI_REVIEW_OUTCOME: advisory",
        user: { login: "claude[bot]" }
      },
      "abc1234"
    ),
    false
  );

  assert.equal(
    isAcceptableClaudeComment(
      {
        body: "AI_REVIEW_AGENT: claude\nAI_REVIEW_SHA: abc1234\nAI_REVIEW_OUTCOME: pass",
        user: { login: "claude-fan-99" }
      },
      "abc1234"
    ),
    false
  );
});

test("findRepoRoot fails clearly outside a repository", () => {
  assert.throws(
    () => findRepoRoot("/tmp"),
    /Could not find repository root/
  );
});
