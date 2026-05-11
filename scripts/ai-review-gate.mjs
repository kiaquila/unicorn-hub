#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import {
  createAiReviewRequestMarkerBody,
  hasHeadUpdateBetweenTimestamps,
  isAcceptableClaudeComment,
  isAcceptableCodexSummaryComment,
  isAcceptableNativeReview,
  latestAiReviewRequestMarker,
  latestCodexNativeReviewResult
} from "./ai-review-helpers.mjs";
import { readConfig } from "./shared.mjs";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.AI_REVIEW_PR_NUMBER;
const headSha = process.env.AI_REVIEW_HEAD_SHA;
const selectedAgent = (process.env.AI_REVIEW_AGENT || "codex").trim().toLowerCase();
const triggerMode = (process.env.AI_REVIEW_TRIGGER_MODE || "skip").trim().toLowerCase();
const maxWaitMs = Number(process.env.AI_REVIEW_WAIT_MS || 30000);
const initialPollMs = Number(process.env.AI_REVIEW_POLL_MS || 5000);
const maxPollMs = Number(process.env.AI_REVIEW_MAX_POLL_MS || 10000);
const debounceMs = Number(process.env.AI_REVIEW_DEBOUNCE_MS || 5000);
const config = readConfig();

if (!token || !repository || !prNumber || !headSha) {
  console.error("GITHUB_TOKEN, GITHUB_REPOSITORY, AI_REVIEW_PR_NUMBER, and AI_REVIEW_HEAD_SHA are required.");
  process.exit(1);
}

if (!new Set(["codex", "claude", "gemini"]).has(selectedAgent)) {
  console.error(`Unsupported AI_REVIEW_AGENT value: ${selectedAgent}`);
  process.exit(1);
}

if (!new Set(["skip", "comment"]).has(triggerMode)) {
  console.error(`Unsupported AI_REVIEW_TRIGGER_MODE value: ${triggerMode}`);
  process.exit(1);
}

const [owner, repo] = repository.split("/");

async function request(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function listPaginated(path) {
  const items = [];
  const separator = path.includes("?") ? "&" : "?";
  for (let page = 1; ; page += 1) {
    const batch = await request(`${path}${separator}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

async function createComment(body) {
  return request(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body })
  });
}

async function fetchPull() {
  return request(`/repos/${owner}/${repo}/pulls/${prNumber}`);
}

async function currentHeadMatches() {
  const pull = await fetchPull();
  return pull.head?.sha === headSha;
}

async function waitForQuietHead() {
  if (!Number.isFinite(debounceMs) || debounceMs <= 0) return true;
  await new Promise((resolve) => setTimeout(resolve, debounceMs));
  return currentHeadMatches();
}

async function maybePostTriggerComment() {
  if (triggerMode !== "comment") return;
  const triggers = {
    codex: "@codex review",
    claude: "@claude review once",
    gemini: "/gemini review"
  };
  const triggerComment = await createComment([
    triggers[selectedAgent],
    "",
    "_Administrative trigger posted by the AI Review workflow. Prefer a trusted human-authored trigger if the native backend ignores bot comments._"
  ].join("\n"));
  const requestedAt = triggerComment?.created_at || new Date().toISOString();
  await createComment(createAiReviewRequestMarkerBody({
    agent: selectedAgent,
    headSha,
    requestId: `workflow-${triggerComment?.id || Date.now()}-${headSha.slice(0, 12)}`,
    sourceCommentId: String(triggerComment?.id || ""),
    sourceCommentCreatedAt: triggerComment?.created_at,
    requestedAt
  }));
}

function isAfterRequest(value, requestMarker) {
  const valueTime = Date.parse(value || "");
  const requestedAt = Date.parse(
    requestMarker?.sourceCommentCreatedAt ||
    requestMarker?.requestedAt ||
    requestMarker?.commentCreatedAt ||
    ""
  );
  return Number.isFinite(valueTime) && Number.isFinite(requestedAt) && valueTime >= requestedAt;
}

async function fetchEvidence() {
  if (!await currentHeadMatches()) return "stale";

  const comments = await listPaginated(`/repos/${owner}/${repo}/issues/${prNumber}/comments`);
  const requestMarker = latestAiReviewRequestMarker(comments, selectedAgent, headSha);
  if (!requestMarker) return "missing_marker";

  if (selectedAgent === "claude") {
    return comments.some((comment) =>
      isAfterRequest(comment.created_at, requestMarker) &&
      isAcceptableClaudeComment(comment, headSha, config)
    ) ? "pass" : "pending";
  }

  const reviews = await listPaginated(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`);
  if (selectedAgent === "codex") {
    const reviewComments = await listPaginated(`/repos/${owner}/${repo}/pulls/${prNumber}/comments`);
    const reviewsAfterRequest = reviews.filter((review) => isAfterRequest(review.submitted_at, requestMarker));
    const latestCodexResult = latestCodexNativeReviewResult(reviewsAfterRequest, reviewComments, headSha, config);
    if (latestCodexResult === "pass") return "pass";
    if (latestCodexResult === "fail") return "fail";

    const timeline = await listPaginated(`/repos/${owner}/${repo}/issues/${prNumber}/timeline`);
    const triggerAt = requestMarker.sourceCommentCreatedAt || requestMarker.requestedAt || requestMarker.commentCreatedAt;
    const summaryAccepted = comments.some((comment) => {
      if (!isAcceptableCodexSummaryComment(comment, headSha, requestMarker, config)) return false;
      if (hasHeadUpdateBetweenTimestamps(timeline, triggerAt, comment.created_at)) {
        console.warn(`AI Review gate rejected Codex summary ${comment.id}: head moved between trigger ${triggerAt} and summary ${comment.created_at}.`);
        return false;
      }
      return true;
    });
    return summaryAccepted ? "pass" : "pending";
  }

  if (reviews.some((review) =>
    isAfterRequest(review.submitted_at, requestMarker) &&
    isAcceptableNativeReview(review, selectedAgent, headSha, config)
  )) {
    return "pass";
  }

  return "pending";
}

await maybePostTriggerComment();

if (!await waitForQuietHead()) {
  console.log(`AI Review gate skipped stale run for ${headSha}; PR head changed during debounce.`);
  process.exit(0);
}

const started = Date.now();
let outcome = "pending";
let lastError = null;
let pollMs = initialPollMs;

while (Date.now() - started <= maxWaitMs) {
  try {
    outcome = await fetchEvidence();
    if (outcome !== "pending") break;
  } catch (error) {
    lastError = error;
  }
  const elapsed = Date.now() - started;
  const remaining = maxWaitMs - elapsed;
  if (remaining <= 0) break;
  await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
  pollMs = Math.min(pollMs * 2, maxPollMs);
}

if (outcome === "stale") {
  console.log(`AI Review gate skipped stale run for ${headSha}; PR head moved.`);
  process.exit(0);
}

if (outcome === "pass") {
  console.log(`AI Review gate passed for ${selectedAgent} on ${headSha}.`);
  process.exit(0);
}

const detail = lastError ? ` Last API error: ${lastError.message}` : "";
const reviewHint = selectedAgent === "claude"
  ? "A trusted human must request Claude review, then Claude must post AI_REVIEW_OUTCOME: pass for the current head SHA."
  : selectedAgent === "codex"
    ? "Codex must provide current-head review evidence after a trusted AI review request marker."
    : `A trusted human must request ${selectedAgent} review, then ${selectedAgent} must provide an acceptable native review for the current head SHA.`;

const triggerCommands = {
  codex: "@codex review",
  claude: "@claude review once",
  gemini: "/gemini review"
};
const actionHint = outcome === "missing_marker"
  ? `Action: a trusted reviewer (OWNER/MEMBER/COLLABORATOR) should post '${triggerCommands[selectedAgent]}' on this PR to record the current-head review request marker.`
  : "";

const failureComment = [
  "AI Review gate failed.",
  "",
  `- agent: ${selectedAgent}`,
  `- head SHA: ${headSha}`,
  `- expected: ${reviewHint}`,
  actionHint ? `- next: ${actionHint}` : "",
  detail ? `- detail: ${detail}` : ""
].filter(Boolean).join("\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${failureComment}\n`);
}

if (outcome === "fail") {
  try {
    await createComment(failureComment);
  } catch (error) {
    console.warn(`Could not post AI Review gate failure comment: ${error.message}`);
  }
}

const outcomeDetail = outcome === "missing_marker"
  ? " Missing trusted current-head AI review request marker."
  : outcome === "pending"
    ? " Review evidence is still pending; rerun will be requested by the next trusted review event."
    : "";

console.error(`AI Review gate failed for ${selectedAgent} on ${headSha}.${outcomeDetail}${detail}`);
process.exit(1);
