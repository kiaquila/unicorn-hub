#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  extractClaudeOutcome,
  isCodexReviewSignal,
  isAiReviewControlComment,
  reviewEvidenceTime,
  isTrustedReviewLogin
} from "./ai-review-helpers.mjs";
import { readConfig } from "./shared.mjs";

const rerunnableConclusions = new Set(["failure", "cancelled", "timed_out", "action_required"]);
const activeStatuses = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

function normalizeAgent(agent) {
  return String(agent || "codex").trim().toLowerCase() || "codex";
}

export function shouldRouteAiReviewRerunEvent(event, selectedAgent = "codex", config = {}) {
  const agent = normalizeAgent(selectedAgent);

  if (event.action && !["created", "edited", "submitted", "dismissed", "deleted"].includes(event.action)) return false;

  if (event?.review) {
    return ["codex", "gemini"].includes(agent) &&
      isTrustedReviewLogin(event.review.user?.login, agent, config);
  }

  if (event?.pull_request && event?.comment?.pull_request_review_id) {
    return agent === "codex" && isTrustedReviewLogin(event.comment.user?.login, "codex", config);
  }

  if (!event?.issue?.pull_request || !event?.comment) return false;
  const body = String(event.comment.body || "");
  const login = event.comment.user?.login;

  if (agent === "codex") {
    return (["edited", "deleted"].includes(event.action) && String(login).toLowerCase() === "github-actions[bot]" &&
      (isAiReviewControlComment(body) || isAiReviewControlComment(event.changes?.body?.from))) ||
      ((["edited", "deleted"].includes(event.action) || isCodexReviewSignal(body)) && isTrustedReviewLogin(login, "codex", config));
  }

  if (agent === "claude") {
    return Boolean(extractClaudeOutcome(body)) && isTrustedReviewLogin(login, "claude", config);
  }

  return false;
}

export function selectAiReviewRun(runs = [], headSha) {
  const matchingRuns = runs
    .filter((run) => run.event === "pull_request" && run.head_sha === headSha)
    .sort((left, right) => Date.parse(right.created_at || "") - Date.parse(left.created_at || ""));

  // Only the newest run matters: an old failure must not supersede success.
  const run = matchingRuns[0];
  if (run && activeStatuses.has(run.status)) return { action: "already_running", run };
  if (run?.status === "completed" && rerunnableConclusions.has(run.conclusion)) return { action: "rerun", run };
  if (run?.status === "completed" && run.conclusion === "success") return { action: "already_success", run };

  return { action: "not_found", run: null };
}

async function defaultRequest(token, repository, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

export async function reviewEventEvidenceTime({ token, repository, event, request = defaultRequest }) {
  // Deletion payloads retain the old content update time, not deletion time.
  // Force a fresh evaluation instead of deduplicating against that old value.
  if (event.action === "deleted") return undefined;
  if (!event.review) return reviewEvidenceTime(event.comment);
  if (!["edited", "dismissed"].includes(event.action)) return event.review.submitted_at;
  // Review webhooks keep the original submitted_at after edits/dismissals.
  // Use server state, not delivery time, so delayed events remain deduplicable.
  if (!event.review.node_id) throw new Error("Missing native review node ID.");
  const result = await request(token, repository, "/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query($id: ID!) { node(id: $id) { __typename ... on PullRequestReview {
        id updatedAt pullRequest { number repository { nameWithOwner } }
      } } }`,
      variables: { id: event.review.node_id }
    })
  });
  const review = result.data?.node;
  if (result.errors || review?.__typename !== "PullRequestReview" || review.id !== event.review.node_id ||
      review.pullRequest?.number !== event.pull_request?.number ||
      review.pullRequest?.repository?.nameWithOwner?.toLowerCase() !== repository.toLowerCase() ||
      !Number.isFinite(Date.parse(review.updatedAt || ""))) {
    throw new Error("Could not verify native review mutation time.");
  }
  return review.updatedAt;
}

async function listPaginated(request, token, repository, path) {
  const items = [];
  const separator = path.includes("?") ? "&" : "?";
  for (let page = 1; ; page += 1) {
    const data = await request(token, repository, `${path}${separator}per_page=100&page=${page}`);
    const batch = data.workflow_runs || data;
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

export async function rerunAiReviewForPrHead({
  token,
  repository,
  headSha,
  prNumber,
  evidenceUpdatedAt,
  forceRerun = false,
  request = defaultRequest,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  maxWaitMs = 120000
}) {
  if (!token || !repository || !headSha) {
    throw new Error("token, repository, and headSha are required to rerun AI Review.");
  }
  const [owner, repo] = repository.split("/");
  const started = now();
  let delay = 2000;
  let cancellationRequested = false;
  let cancellationStarted;
  let forceCancellationRequested = false;
  while (true) {
    if (prNumber) {
      const pull = await request(token, repository, `/repos/${owner}/${repo}/pulls/${prNumber}`);
      if (pull.state !== "open" || pull.head?.sha !== headSha) {
        return { action: "stale_head", run: null, message: `AI Review wakeup ignored: PR head no longer matches ${headSha}.` };
      }
    }
    const runs = await listPaginated(request, token, repository,
      `/repos/${owner}/${repo}/actions/workflows/ai-review.yml/runs?event=pull_request&head_sha=${encodeURIComponent(headSha)}`);
    const selected = selectAiReviewRun(runs, headSha);
    if (selected.action === "already_running") {
      // A running gate may have read evidence just before this event. Wait for
      // completion, then schedule exactly one fresh attempt if needed.
      const remaining = maxWaitMs - (now() - started);
      if (remaining <= 0 && !cancellationRequested) {
        cancellationRequested = true;
        cancellationStarted = now();
        try {
          await request(token, repository, `/repos/${owner}/${repo}/actions/runs/${selected.run.id}/cancel`, { method: "POST" });
        } catch (error) {
          const current = await request(token, repository, `/repos/${owner}/${repo}/actions/runs/${selected.run.id}`);
          if (current.status !== "completed") throw error;
        }
        // 202 only acknowledges cancellation. Keep the wakeup until terminal
        // state is observed, then rerun even when stale success won the race.
        continue;
      }
      if (cancellationRequested && !forceCancellationRequested && now() - cancellationStarted >= 30000) {
        forceCancellationRequested = true;
        try {
          await request(token, repository, `/repos/${owner}/${repo}/actions/runs/${selected.run.id}/force-cancel`, { method: "POST" });
        } catch (error) {
          const current = await request(token, repository, `/repos/${owner}/${repo}/actions/runs/${selected.run.id}`);
          if (current.status !== "completed") throw error;
        }
        continue;
      }
      await sleep(cancellationRequested ? delay : Math.min(delay, remaining));
      delay = Math.min(delay * 2, 10000);
      continue;
    }
    let alreadyEvaluated = false;
    if (!forceRerun && !cancellationRequested && evidenceUpdatedAt && selected.run) {
      // The attempt endpoint records the latest rerun start rather than the
      // original run creation time. This suppresses duplicate/delayed events.
      const attempt = await request(token, repository,
        `/repos/${owner}/${repo}/actions/runs/${selected.run.id}/attempts/${selected.run.run_attempt || 1}`);
      const attemptStart = Date.parse(attempt.run_started_at || "");
      const evidenceTime = Date.parse(evidenceUpdatedAt);
      alreadyEvaluated = Number.isFinite(attemptStart) && Number.isFinite(evidenceTime) && attemptStart > evidenceTime;
    }
    if (selected.run && !alreadyEvaluated && (selected.action === "rerun" || evidenceUpdatedAt || forceRerun || cancellationRequested)) {
      // Close the list-runs/new-push race immediately before mutation.
      if (prNumber) {
        const pull = await request(token, repository, `/repos/${owner}/${repo}/pulls/${prNumber}`);
        if (pull.state !== "open" || pull.head?.sha !== headSha) {
          return { action: "stale_head", run: null, message: `AI Review wakeup ignored: PR head changed before rerun of ${headSha}.` };
        }
      }
      await request(token, repository, `/repos/${owner}/${repo}/actions/runs/${selected.run.id}/rerun`, { method: "POST" });
      return { ...selected, action: "rerun", message: `Requested AI Review rerun for ${headSha} from run ${selected.run.id}.` };
    }
    const action = alreadyEvaluated ? "already_evaluated" : selected.action;
    return { ...selected, action, message: `AI Review wakeup ${action} for ${headSha}.` };
  }
}

export async function recordReviewWithdrawal({ token, repository, runId, defaultBranch, selectedAgent = "codex", config = {}, request = defaultRequest }) {
  if (normalizeAgent(selectedAgent) !== "codex") return { action: "ignored" };
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error("Invalid withdrawal source run ID.");
  const prefix = `/repos/${repository}`;
  // Treat workflow-run metadata as data only. The writer executes solely in the
  // default-branch workflow_run controller; it never downloads PR artifacts.
  const run = await request(token, repository, `${prefix}/actions/runs/${runId}`);
  const title = String(run.display_title || "").match(/^AI review evidence:(issue_comment|pull_request_review_comment):(deleted|edited):([1-9][0-9]*):([^:]+):(true|false)$/);
  if (typeof run.path !== "string" || run.repository?.full_name?.toLowerCase() !== repository.toLowerCase() ||
      !title || title[1] !== run.event || !Number.isFinite(Date.parse(run.created_at || ""))) return { action: "ignored" };
  const nativeDeletion = title[2] === "deleted" && isTrustedReviewLogin(title[4], "codex", config);
  const machineMutation = title[4].toLowerCase() === "github-actions[bot]" && title[5] === "true";
  if (!nativeDeletion && !machineMutation) return { action: "ignored" };
  const prNumber = Number(title[3]);
  if (!Number.isSafeInteger(prNumber)) throw new Error("Invalid withdrawal PR number.");
  const workflowPath = ".github/workflows/ai-review-rerun.yml";
  const workflowRef = run.path.startsWith(`${workflowPath}@`) ? run.path.slice(workflowPath.length + 1) : null;
  if (run.path !== workflowPath && (!workflowRef || ![
    run.head_branch, run.head_sha, run.head_branch && `refs/heads/${run.head_branch}`,
    defaultBranch, defaultBranch && `refs/heads/${defaultBranch}`,
    ...(run.event === "pull_request_review_comment" ? [`refs/pull/${prNumber}/merge`, `refs/pull/${prNumber}/head`] : [])
  ].filter(Boolean).includes(workflowRef))) return { action: "ignored" };

  // issue_comment definitions come from the default branch. For PR-context
  // runs, constrain this negative-only record to the API-associated PR, so a
  // contributor cannot use a forged run title to write on another PR.
  if (run.event === "issue_comment" ? !defaultBranch || run.head_branch !== defaultBranch
    : !run.pull_requests?.some((pull) => pull.number === prNumber)) return { action: "ignored" };
  const pull = await request(token, repository, `${prefix}/pulls/${prNumber}`);
  if (pull.state !== "open") return { action: "closed" };
  const headSha = pull.head?.sha;
  if (!/^[a-f0-9]{40}$/.test(headSha || "")) throw new Error("Invalid withdrawal PR head.");
  const record = { agent: "codex", head_sha: headSha, pr_number: prNumber, source_created_at: run.created_at, source_run_id: runId };
  const body = `<!-- unicorn-hub:ai-review-withdrawal:v1 ${JSON.stringify(record)} -->`;
  const comments = await listPaginated(request, token, repository, `${prefix}/issues/${prNumber}/comments`);
  let marker = comments.find((comment) => comment.user?.login?.toLowerCase() === "github-actions[bot]" && comment.body === body);
  if (!marker) marker = await request(token, repository, `${prefix}/issues/${prNumber}/comments`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body })
  });
  if (!Number.isFinite(Date.parse(marker?.created_at || ""))) throw new Error("Missing withdrawal publication time.");
  return rerunAiReviewForPrHead({ token, repository, headSha, prNumber, evidenceUpdatedAt: marker.created_at, request });
}

async function resolvePullContext({ token, repository, event, request = defaultRequest }) {
  const number = event?.pull_request?.number || (event?.issue?.pull_request && event?.issue?.number);
  if (!number) throw new Error("Could not resolve pull request from event.");

  const [owner, repo] = repository.split("/");
  const pull = await request(token, repository, `/repos/${owner}/${repo}/pulls/${number}`);
  return {
    prNumber: pull.number,
    headSha: pull.head?.sha
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const selectedAgent = normalizeAgent(process.env.AI_REVIEW_AGENT);
  const config = readConfig();

  if (!token || !repository || !eventPath) {
    console.error("GITHUB_TOKEN, GITHUB_REPOSITORY, and GITHUB_EVENT_PATH are required.");
    process.exit(1);
  }

  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  if (process.env.GITHUB_EVENT_NAME === "workflow_run") {
    const result = await recordReviewWithdrawal({ token, repository, runId: event.workflow_run?.id, defaultBranch: event.repository?.default_branch, selectedAgent, config });
    console.log(result.message || `Review withdrawal ${result.action}.`);
    return;
  }
  if (!shouldRouteAiReviewRerunEvent(event, selectedAgent, config)) {
    console.log("AI Review rerun skipped: event is not trusted review evidence for the selected agent.");
    return;
  }

  const context = await resolvePullContext({ token, repository, event });
  const evidenceUpdatedAt = await reviewEventEvidenceTime({ token, repository, event });
  const result = await rerunAiReviewForPrHead({
    token,
    repository,
    headSha: context.headSha,
    prNumber: context.prNumber,
    evidenceUpdatedAt,
    forceRerun: event.action === "deleted"
  });
  console.log(result.message);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`AI Review rerun failed: ${error.message}`);
    process.exit(1);
  }
}
