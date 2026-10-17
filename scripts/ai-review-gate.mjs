#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import {
  createAiReviewRequestMarkerBody,
  evaluateCodexEvidence,
  isAcceptableClaudeComment,
  isAcceptableNativeReview,
  isCodexReviewSignal,
  isTrustedReviewLogin,
  latestAiReviewRequestMarker
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

async function fetchReviewThreads() {
  const threads = [];
  let cursor = null;
  do {
    const result = await request("/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $cursor) {
                nodes { isResolved comments(first: 100) { nodes { author { login __typename } } pageInfo { hasNextPage } } }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }`,
        variables: { owner, repo, number: Number(prNumber), cursor }
      })
    });
    const connection = result.data?.repository?.pullRequest?.reviewThreads;
    if (result.errors || !connection || connection.nodes.some((thread) => thread.comments.pageInfo.hasNextPage) ||
        (connection.pageInfo.hasNextPage && !connection.pageInfo.endCursor)) {
      throw new Error("Could not completely verify unresolved review threads.");
    }
    threads.push(...connection.nodes);
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return threads;
}

async function fetchCodexReviews() {
  const reviews = [];
  let cursor = null;
  do {
    const result = await request("/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
            reviews(first: 100, after: $cursor) {
              nodes { databaseId state body submittedAt updatedAt lastEditedAt commit { oid } author { login __typename } }
              pageInfo { hasNextPage endCursor }
            }
          } }
        }`,
        variables: { owner, repo, number: Number(prNumber), cursor }
      })
    });
    const connection = result.data?.repository?.pullRequest?.reviews;
    if (result.errors || !connection ||
        connection.nodes.some((review) => !Number.isFinite(Date.parse(review.updatedAt || ""))) ||
        (connection.pageInfo.hasNextPage && !connection.pageInfo.endCursor)) {
      throw new Error("Could not completely verify native review updates.");
    }
    reviews.push(...connection.nodes.map((review) => ({
      id: review.databaseId, state: review.state, body: review.body,
      submitted_at: review.submittedAt, updated_at: review.updatedAt, last_edited_at: review.lastEditedAt, commit_id: review.commit?.oid,
      user: { login: review.author?.__typename === "Bot" && !review.author.login.endsWith("[bot]")
        ? `${review.author.login}[bot]` : review.author?.login }
    })));
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return reviews;
}

async function fetchPriorReviewSignal(comment) {
  if (!comment.node_id) throw new Error("Missing native comment node ID.");
  let cursor = null;
  let snapshotTime = null;
  do {
    const result = await request("/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query($id: ID!, $cursor: String) { node(id: $id) { ... on IssueComment {
          id body updatedAt lastEditedAt includesCreatedEdit userContentEdits(first: 100, after: $cursor) {
            nodes { diff } pageInfo { hasNextPage endCursor }
          }
        } } }`,
        variables: { id: comment.node_id, cursor }
      })
    });
    const node = result.data?.node;
    const connection = node?.userContentEdits;
    if (result.errors || node?.id !== comment.node_id || !connection ||
        !Number.isFinite(Date.parse(node.updatedAt || "")) || (snapshotTime && node.updatedAt !== snapshotTime) ||
        connection.nodes.some((edit) => typeof edit.diff !== "string") ||
        (connection.pageInfo.hasNextPage && !connection.pageInfo.endCursor)) {
      throw new Error("Could not completely verify native comment edit history.");
    }
    snapshotTime = node.updatedAt;
    comment.body = node.body;
    comment.updated_at = node.updatedAt;
    if (isCodexReviewSignal(node.body) || connection.nodes.some((edit) => isCodexReviewSignal(edit.diff))) return true;
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    if (!cursor && node.lastEditedAt && !node.includesCreatedEdit) {
      throw new Error("Native comment creation history is unavailable.");
    }
  } while (cursor);
  return false;
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

  if (selectedAgent === "codex") {
    for (const comment of comments) {
      if (isTrustedReviewLogin(comment.user?.login, "codex", config) && !isCodexReviewSignal(comment.body)) {
        comment.prior_review_signal = await fetchPriorReviewSignal(comment);
      }
    }
    const reviews = await fetchCodexReviews();
    const reviewComments = await listPaginated(`/repos/${owner}/${repo}/pulls/${prNumber}/comments`);
    const timeline = await listPaginated(`/repos/${owner}/${repo}/issues/${prNumber}/timeline`);
    const threads = await fetchReviewThreads();
    return evaluateCodexEvidence({ comments, reviews, reviewComments, timeline, threads, headSha, requestMarker, config });
  }

  const reviews = await listPaginated(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`);
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
  console.log(`AI Review gate rejected stale run for ${headSha}; PR head changed during debounce.`);
  process.exit(1);
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
  console.log(`AI Review gate rejected stale run for ${headSha}; PR head moved.`);
  process.exit(1);
}

if (outcome === "pass" && !await currentHeadMatches()) outcome = "stale";

if (outcome === "stale") {
  console.error(`AI Review gate rejected stale result for ${headSha}; PR head moved before publication.`);
  process.exit(1);
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
