#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  extractClaudeOutcome,
  isCodexReviewSignal,
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

  if (event.action && !["created", "edited", "submitted"].includes(event.action)) return false;

  if (event?.review) {
    return ["codex", "gemini"].includes(agent) &&
      isTrustedReviewLogin(event.review.user?.login, agent, config);
  }

  if (!event?.issue?.pull_request || !event?.comment) return false;
  const body = String(event.comment.body || "");
  const login = event.comment.user?.login;

  if (agent === "codex") {
    return isCodexReviewSignal(body) && isTrustedReviewLogin(login, "codex", config);
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
      if (remaining <= 0) throw new Error(`AI Review is still active for ${headSha}; retry this evidence wakeup after run ${selected.run.id} completes.`);
      await sleep(Math.min(delay, remaining));
      delay = Math.min(delay * 2, 10000);
      continue;
    }
    let alreadyEvaluated = false;
    if (evidenceUpdatedAt && selected.run) {
      // The attempt endpoint records the latest rerun start rather than the
      // original run creation time. This suppresses duplicate/delayed events.
      const attempt = await request(token, repository,
        `/repos/${owner}/${repo}/actions/runs/${selected.run.id}/attempts/${selected.run.run_attempt || 1}`);
      const attemptStart = Date.parse(attempt.run_started_at || "");
      const evidenceTime = Date.parse(evidenceUpdatedAt);
      alreadyEvaluated = Number.isFinite(attemptStart) && Number.isFinite(evidenceTime) && attemptStart > evidenceTime;
    }
    if (selected.run && !alreadyEvaluated && (selected.action === "rerun" || evidenceUpdatedAt)) {
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
  if (!shouldRouteAiReviewRerunEvent(event, selectedAgent, config)) {
    console.log("AI Review rerun skipped: event is not trusted review evidence for the selected agent.");
    return;
  }

  const context = await resolvePullContext({ token, repository, event });
  const result = await rerunAiReviewForPrHead({
    token,
    repository,
    headSha: context.headSha,
    prNumber: context.prNumber,
    evidenceUpdatedAt: event.review?.submitted_at || reviewEvidenceTime(event.comment)
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
