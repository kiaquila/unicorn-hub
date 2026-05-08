import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCodexNativeReview,
  containsBlockingSeverity,
  createAiReviewRequestMarkerBody,
  extractCodexPriority,
  extractAiReviewRequestMarker,
  extractClaudeOutcome,
  extractMarkerSha,
  hasHeadUpdateBetweenTimelineComments,
  isAiReviewRequestMarkerComment,
  isAcceptableClaudeComment,
  isAcceptableCodexSummaryComment,
  isAcceptableNativeReview,
  latestAiReviewRequestMarker,
  latestCodexNativeReviewResult,
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

test("AI review request markers bind trusted comments to a head SHA", () => {
  const body = createAiReviewRequestMarkerBody({
    agent: "codex",
    headSha: "abc123def456",
    requestId: "10-abc123def456",
    sourceCommentId: "10",
    sourceCommentCreatedAt: "2026-04-29T19:29:46Z",
    requestedAt: "2026-04-29T19:29:46Z"
  });

  assert.deepEqual(extractAiReviewRequestMarker(body), {
    requestId: "10-abc123def456",
    agent: "codex",
    sha: "abc123def456",
    sourceCommentId: "10",
    sourceCommentCreatedAt: "2026-04-29T19:29:46Z",
    requestedAt: "2026-04-29T19:29:46Z"
  });

  const markerComment = {
    id: 11,
    body,
    created_at: "2026-04-29T19:29:47Z",
    user: { login: "github-actions[bot]" }
  };
  assert.equal(isAiReviewRequestMarkerComment(markerComment, "codex", "abc123def456"), true);
  assert.equal(isAiReviewRequestMarkerComment({
    ...markerComment,
    user: { login: "repo-owner" }
  }, "codex", "abc123def456"), false);
  assert.equal(latestAiReviewRequestMarker([markerComment], "codex", "abc123def456").requestId, "10-abc123def456");
});

test("Codex no-findings summary is accepted only after a matching request marker", () => {
  const requestMarker = {
    agent: "codex",
    sha: "abc123def456",
    requestedAt: "2026-04-29T19:29:46Z",
    sourceCommentId: "10"
  };

  assert.equal(
    isAcceptableCodexSummaryComment({
      body: "Codex Review: Didn't find any major issues. Can't wait for the next one!",
      user: { login: "chatgpt-codex-connector[bot]" },
      created_at: "2026-04-29T19:32:55Z"
    }, "abc123def456", requestMarker),
    true
  );

  assert.equal(
    isAcceptableCodexSummaryComment({
      body: "Codex Review: Didn't find any major issues. Can't wait for the next one!",
      user: { login: "chatgpt-codex-connector[bot]" },
      created_at: "2026-04-29T19:29:46Z"
    }, "abc123def456", requestMarker),
    true
  );

  assert.equal(
    isAcceptableCodexSummaryComment({
      body: "Codex Review: Didn't find any major issues on a stale head.",
      user: { login: "chatgpt-codex-connector[bot]" },
      created_at: "2026-04-29T19:00:00Z"
    }, "abc123def456", requestMarker),
    false
  );

  assert.equal(
    isAcceptableCodexSummaryComment({
      body: "Codex Review: Didn't find any major issues.",
      user: { login: "chatgpt-codex-connector[bot]" },
      created_at: "2026-04-29T19:32:55Z"
    }, "abc123def456", "2026-04-29T19:29:46Z"),
    false
  );
});

test("summary comments are rejected when the head moved after the source trigger", () => {
  assert.equal(hasHeadUpdateBetweenTimelineComments([
    { event: "commented", id: 10 },
    { event: "commented", id: 11 }
  ], 10, 11), false);

  assert.equal(hasHeadUpdateBetweenTimelineComments([
    { event: "commented", id: 10 },
    { event: "committed", sha: "new" },
    { event: "commented", id: 11 }
  ], 10, 11), true);

  assert.equal(hasHeadUpdateBetweenTimelineComments([
    { event: "commented", id: 10 },
    { event: "head_ref_force_pushed", commit_id: "new" },
    { event: "commented", id: 11 }
  ], 10, 11), true);
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

test("latest Codex native review result wins for a head", () => {
  const olderPass = {
    id: 1,
    commit_id: "abc",
    state: "COMMENTED",
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "chatgpt-codex-connector[bot]" }
  };
  const newerFail = {
    id: 2,
    commit_id: "abc",
    state: "COMMENTED",
    submitted_at: "2026-01-01T00:01:00Z",
    user: { login: "chatgpt-codex-connector[bot]" }
  };

  assert.equal(latestCodexNativeReviewResult([olderPass, newerFail], [
    {
      pull_request_review_id: 2,
      body: "![P1 Badge] blocker",
      user: { login: "chatgpt-codex-connector[bot]" }
    }
  ], "abc"), "fail");

  assert.equal(latestCodexNativeReviewResult([newerFail, olderPass], [], "different-head"), null);
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
