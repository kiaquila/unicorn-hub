import test from "node:test";
import assert from "node:assert/strict";
import {
  containsBlockingSeverity,
  extractClaudeOutcome,
  extractMarkerSha,
  isAcceptableClaudeComment,
  isAcceptableNativeReview,
  isTrustedAssociation
} from "../scripts/ai-review-helpers.mjs";

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
        user: { login: "codex-reviewer[bot]" }
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
});
