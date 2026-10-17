import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  rerunAiReviewForPrHead,
  recordReviewWithdrawal,
  reviewEventEvidenceTime,
  selectAiReviewRun,
  shouldRouteAiReviewRerunEvent
} from "../scripts/ai-review-rerun.mjs";

test("AI Review rerun event filter accepts trusted selected-agent evidence", () => {
  assert.equal(
    shouldRouteAiReviewRerunEvent(
      {
        issue: { pull_request: {} },
        comment: {
          body: "Codex Review: Didn't find any major issues.",
          user: { login: "chatgpt-codex-connector[bot]" }
        }
      },
      "codex"
    ),
    true
  );

  assert.equal(
    shouldRouteAiReviewRerunEvent(
      {
        issue: { pull_request: {} },
        comment: {
          body: "Codex Review: Didn't find any major issues.",
          user: { login: "random-user" }
        }
      },
      "codex"
    ),
    false
  );

  assert.equal(
    shouldRouteAiReviewRerunEvent(
      {
        issue: { pull_request: {} },
        comment: {
          body: [
            "AI_REVIEW_AGENT: claude",
            "AI_REVIEW_SHA: abc1234",
            "AI_REVIEW_OUTCOME: pass"
          ].join("\n"),
          user: { login: "claude[bot]" }
        }
      },
      "claude"
    ),
    true
  );

  assert.equal(
    shouldRouteAiReviewRerunEvent(
      {
        review: {
          user: { login: "gemini-code-assist[bot]" }
        }
      },
      "gemini"
    ),
    true
  );
});

test("AI Review rerun event filter rejects untrusted review evidence", () => {
  assert.equal(
    shouldRouteAiReviewRerunEvent(
      {
        review: {
          user: { login: "drive-by-attacker" }
        }
      },
      "codex"
    ),
    false,
    "untrusted login must not be treated as review evidence"
  );

  assert.equal(
    shouldRouteAiReviewRerunEvent(
      {
        review: {
          user: { login: "claude[bot]" }
        }
      },
      "claude"
    ),
    false,
    "claude review evidence arrives via issue_comment, not pull_request_review"
  );

  assert.equal(
    shouldRouteAiReviewRerunEvent(
      {
        review: {
          user: { login: "chatgpt-codex-connector[bot]" }
        }
      },
      "gemini"
    ),
    false,
    "trusted login for a different agent must not satisfy the rerun trigger"
  );

  assert.equal(
    shouldRouteAiReviewRerunEvent(
      {
        issue: { pull_request: {} },
        comment: {
          body: "AI_REVIEW_OUTCOME: pass",
          user: { login: "random-user" }
        }
      },
      "claude"
    ),
    false,
    "outcome comment from an untrusted login must not trigger rerun"
  );
});

test("AI Review rerun selector reports already_success and not_found states", () => {
  const successRun = {
    id: 11,
    event: "pull_request",
    head_sha: "abc",
    status: "completed",
    conclusion: "success",
    created_at: "2026-05-01T09:00:00Z"
  };
  assert.deepEqual(selectAiReviewRun([successRun], "abc"), {
    action: "already_success",
    run: successRun
  });

  assert.deepEqual(selectAiReviewRun([], "abc"), {
    action: "not_found",
    run: null
  });

  const dispatchRun = {
    id: 12,
    event: "workflow_dispatch",
    head_sha: "abc",
    status: "completed",
    conclusion: "failure",
    created_at: "2026-05-01T09:30:00Z"
  };
  assert.deepEqual(
    selectAiReviewRun([dispatchRun], "abc"),
    { action: "not_found", run: null },
    "workflow_dispatch runs must not satisfy the rerun selector"
  );
});

test("AI Review rerun selector prefers active runs, then latest rerunnable failures", () => {
  const runs = [
    {
      id: 1,
      event: "pull_request",
      head_sha: "abc",
      status: "completed",
      conclusion: "failure",
      created_at: "2026-05-01T10:00:00Z"
    },
    {
      id: 2,
      event: "pull_request",
      head_sha: "abc",
      status: "completed",
      conclusion: "failure",
      created_at: "2026-05-01T10:05:00Z"
    },
    {
      id: 3,
      event: "pull_request",
      head_sha: "old",
      status: "completed",
      conclusion: "failure",
      created_at: "2026-05-01T10:10:00Z"
    }
  ];

  assert.deepEqual(selectAiReviewRun(runs, "abc"), { action: "rerun", run: runs[1] });

  const queued = {
    id: 4,
    event: "pull_request",
    head_sha: "abc",
    status: "queued",
    conclusion: null,
    created_at: "2026-05-01T10:15:00Z"
  };

  assert.deepEqual(selectAiReviewRun([...runs, queued], "abc"), {
    action: "already_running",
    run: queued
  });
});

test("AI Review rerun helper calls the workflow rerun endpoint for current-head failure", async () => {
  const calls = [];
  const request = async (_token, _repository, path, options = {}) => {
    calls.push({ path, method: options.method || "GET" });
    if (path.includes("/actions/workflows/ai-review.yml/runs")) {
      return {
        workflow_runs: [
          {
            id: 42,
            event: "pull_request",
            head_sha: "abc",
            status: "completed",
            conclusion: "failure",
            created_at: "2026-05-01T10:00:00Z"
          }
        ]
      };
    }
    return null;
  };

  const result = await rerunAiReviewForPrHead({
    token: "token",
    repository: "owner/repo",
    headSha: "abc",
    request
  });

  assert.equal(result.action, "rerun");
  assert.match(result.message, /Requested AI Review rerun/);
  assert.deepEqual(calls, [
    {
      path: "/repos/owner/repo/actions/workflows/ai-review.yml/runs?event=pull_request&head_sha=abc&per_page=100&page=1",
      method: "GET"
    },
    {
      path: "/repos/owner/repo/actions/runs/42/rerun",
      method: "POST"
    }
  ]);
});

const nativeReceipt = "<!-- codex-review-receipt:v1 -->\n\nCodex Review: Didn't find any major issues. :rocket:\n\n**Reviewed commit:** `0123456789`";
const nativeSummary = '<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {"code_review":{"status":"in_progress"}} -->';

test("runtime router wakes on created/edited receipts and mutable summaries without trusting their verdict", () => {
  for (const action of ["created", "edited"]) {
    for (const body of [nativeReceipt, nativeSummary, "<!-- codex-review-state:v1 malformed -->"]) {
      const event = { action, issue: { pull_request: {}, number: 1 }, comment: { body, user: { login: "chatgpt-codex-connector[bot]" } } };
      assert.equal(shouldRouteAiReviewRerunEvent(event, "codex"), true);
      assert.equal(shouldRouteAiReviewRerunEvent({ ...event, comment: { ...event.comment, user: { login: "someone-else[bot]" } } }, "codex"), false);
      assert.equal(shouldRouteAiReviewRerunEvent(event, "gemini"), false);
      assert.equal(shouldRouteAiReviewRerunEvent({ ...event, action: "deleted" }, "codex"), true);
      assert.equal(shouldRouteAiReviewRerunEvent({ ...event, action: "labeled" }, "codex"), false);
    }
  }
});

function wakeupHarness({ statuses = ["completed"], conclusion = "failure", attemptStart = "2026-10-01T10:00:00Z", heads = ["abc"], maxWaitMs = 1000, forceRerun = false, evidenceUpdatedAt = "2026-10-01T10:01:00Z" } = {}) {
  const calls = [];
  let clock = 0, listings = 0, pulls = 0;
  const request = async (_token, _repository, path, options = {}) => {
    calls.push({ path, method: options.method || "GET" });
    if (/\/pulls\/1$/.test(path)) return { state: "open", head: { sha: heads[Math.min(pulls++, heads.length - 1)] } };
    if (path.includes("/workflows/ai-review.yml/runs")) {
      const status = statuses[Math.min(listings++, statuses.length - 1)];
      return { workflow_runs: [{ id: 42, event: "pull_request", head_sha: "abc", status, conclusion: status === "completed" ? conclusion : null, run_attempt: 2, created_at: "2026-10-01T09:00:00Z" }] };
    }
    if (path.includes("/attempts/2")) return { run_started_at: attemptStart };
    if (options.method === "POST" && (path.endsWith("/rerun") || path.endsWith("/cancel"))) return null;
    throw new Error(`Unexpected request ${path}`);
  };
  return {
    calls,
    run: () => rerunAiReviewForPrHead({ token: "synthetic", repository: "example/project", headSha: "abc", prNumber: 1, evidenceUpdatedAt, forceRerun, request, sleep: async (ms) => { clock += ms; }, now: () => clock, maxWaitMs })
  };
}

test("wakeup received during active gate waits then reruns even if the old attempt succeeded", async () => {
  for (const conclusion of ["failure", "success"]) {
    const harness = wakeupHarness({ statuses: ["in_progress", "completed"], conclusion });
    assert.equal((await harness.run()).action, "rerun");
    assert.equal(harness.calls.filter((call) => call.method === "POST").length, 1);
  }
});

test("new edited evidence invalidates success, while a later attempt suppresses duplicate events", async () => {
  assert.equal((await wakeupHarness({ conclusion: "success" }).run()).action, "rerun");
  const duplicate = wakeupHarness({ attemptStart: "2026-10-01T10:02:00Z" });
  assert.equal((await duplicate.run()).action, "already_evaluated");
  assert.equal(duplicate.calls.filter((call) => call.method === "POST").length, 0);
});

test("wakeup refuses stale heads both before listing and immediately before rerun", async () => {
  for (const heads of [["old"], ["abc", "new"]]) {
    const harness = wakeupHarness({ heads });
    assert.equal((await harness.run()).action, "stale_head");
    assert.equal(harness.calls.filter((call) => call.method === "POST").length, 0);
  }
});

test("active gate timeout cancels stale evaluation instead of losing the event", async () => {
  const harness = wakeupHarness({ statuses: ["in_progress", "in_progress", "in_progress", "completed"], maxWaitMs: 0, conclusion: "success" });
  assert.equal((await harness.run()).action, "rerun");
  assert.deepEqual(harness.calls.filter((call) => call.method === "POST").map((call) => call.path), ["/repos/example/project/actions/runs/42/cancel", "/repos/example/project/actions/runs/42/rerun"]);
  const cancelIndex = harness.calls.findIndex((call) => call.path.endsWith("/cancel"));
  assert.ok(harness.calls.slice(cancelIndex + 1).some((call) => call.path.includes("/workflows/ai-review.yml/runs")), "202 must be followed by terminal-state polling");
  assert.equal((await wakeupHarness({ statuses: ["in_progress", "completed"], maxWaitMs: 0, conclusion: "success", evidenceUpdatedAt: null }).run()).action, "rerun", "confirmed cancellation also requires freshness without an event timestamp");
});

test("selector never resurrects an older failed run after a newer success", () => {
  const runs = [
    { id: 1, event: "pull_request", head_sha: "abc", status: "completed", conclusion: "failure", created_at: "2026-10-01T10:00:00Z" },
    { id: 2, event: "pull_request", head_sha: "abc", status: "completed", conclusion: "success", created_at: "2026-10-01T10:01:00Z" }
  ];
  assert.equal(selectAiReviewRun(runs, "abc").action, "already_success");
  assert.equal(selectAiReviewRun(runs, "abc").run.id, 2);
});


test("formal review submissions, edits, and dismissals route only trusted selected reviewers", () => {
  for (const action of ["submitted", "edited", "dismissed"]) {
    const event = { action, review: { user: { login: "chatgpt-codex-connector[bot]" } } };
    assert.equal(shouldRouteAiReviewRerunEvent(event), true);
    assert.equal(shouldRouteAiReviewRerunEvent({ ...event, review: { user: { login: "untrusted[bot]" } } }), false);
  }
});

test("native mutation wakeups use verified server update time and fail closed on missing metadata", async () => {
  for (const action of ["edited", "dismissed"]) {
    const event = { action, pull_request: { number: 1 }, review: { node_id: "review-id", submitted_at: "2026-10-01T10:00:00Z" } };
    const node = { __typename: "PullRequestReview", id: "review-id", updatedAt: "2026-10-01T10:03:00Z", pullRequest: { number: 1, repository: { nameWithOwner: "example/project" } } };
    const run = (result) => reviewEventEvidenceTime({ token: "synthetic", repository: "example/project", event, request: async (_token, _repo, path, options) => {
      assert.equal(path, "/graphql");
      assert.equal(JSON.parse(options.body).variables.id, "review-id");
      return result;
    } });
    assert.equal(await run({ data: { node } }), node.updatedAt);
    for (const result of [{ errors: [{ message: "denied" }], data: { node } }, { data: { node: null } }, { data: { node: { ...node, updatedAt: null } } }, { data: { node: { ...node, pullRequest: { ...node.pullRequest, number: 2 } } } }]) {
      await assert.rejects(() => run(result), /Could not verify/);
    }
  }
});


test("trusted Codex edits still wake validation after removing every review marker", () => {
  for (const body of ["Review withdrawn", ""]) {
    const event = { action: "edited", issue: { number: 1, pull_request: {} }, comment: { body, user: { login: "chatgpt-codex-connector[bot]" } } };
    assert.equal(shouldRouteAiReviewRerunEvent(event), true);
    assert.equal(shouldRouteAiReviewRerunEvent({ ...event, comment: { ...event.comment, user: { login: "untrusted[bot]" } } }), false);
  }
});


test("native issue deletions and inline comment mutations route through trusted identities", async () => {
  for (const action of ["created", "edited", "deleted"]) {
    const event = { action, pull_request: { number: 1 }, comment: { pull_request_review_id: 2, body: "P1 blocker", updated_at: "2026-10-01T10:03:00Z", user: { login: "chatgpt-codex-connector[bot]" } } };
    assert.equal(shouldRouteAiReviewRerunEvent(event), true);
    assert.equal(shouldRouteAiReviewRerunEvent({ ...event, comment: { ...event.comment, user: { login: "untrusted[bot]" } } }), false);
    const timestamp = await reviewEventEvidenceTime({ event });
    assert.equal(timestamp, action === "deleted" ? undefined : event.comment.updated_at);
  }
  const issueDeletion = { action: "deleted", issue: { number: 1, pull_request: {} }, comment: { body: "Review withdrawn", user: { login: "chatgpt-codex-connector[bot]" } } };
  assert.equal(shouldRouteAiReviewRerunEvent(issueDeletion), true);
  assert.equal(await reviewEventEvidenceTime({ event: issueDeletion }), undefined);
});

test("deletions force a fresh evaluation after success despite the deleted comment's old timestamp", async () => {
  const deletion = wakeupHarness({ conclusion: "success", attemptStart: "2026-10-01T10:04:00Z", forceRerun: true });
  assert.equal((await deletion.run()).action, "rerun");
  assert.equal(deletion.calls.filter((call) => call.path.includes("/attempts/")).length, 0);
  assert.equal(deletion.calls.filter((call) => call.method === "POST").length, 1);
  const evidenceUpdatedAt = "2026-10-01T10:03:00Z";
  assert.equal((await wakeupHarness({ conclusion: "success", attemptStart: "2026-10-01T10:02:00Z", evidenceUpdatedAt }).run()).action, "rerun");
  assert.equal((await wakeupHarness({ conclusion: "success", attemptStart: "2026-10-01T10:04:00Z", evidenceUpdatedAt }).run()).action, "already_evaluated");
});


test("completion racing stale-run cancellation still receives a fresh rerun", async () => {
  let listings = 0;
  const mutations = [];
  const result = await rerunAiReviewForPrHead({ token: "synthetic", repository: "example/project", headSha: "abc", prNumber: 1,
    evidenceUpdatedAt: "2026-10-01T10:01:00Z", maxWaitMs: 0,
    request: async (_token, _repository, path, options = {}) => {
      if (path.endsWith("/pulls/1")) return { state: "open", head: { sha: "abc" } };
      if (path.includes("/workflows/ai-review.yml/runs")) return { workflow_runs: [{ id: 42, event: "pull_request", head_sha: "abc", status: listings++ ? "completed" : "in_progress", conclusion: "success", run_attempt: 1 }] };
      if (options.method === "POST") {
        mutations.push(path);
        if (path.endsWith("/cancel")) throw new Error("409 already completed");
        if (path.endsWith("/rerun")) return null;
      }
      if (path.endsWith("/runs/42")) return { status: "completed", conclusion: "success" };
      if (path.endsWith("/attempts/1")) return { run_started_at: "2026-10-01T10:00:00Z" };
      throw new Error(`Unexpected request ${path}`);
    }
  });
  assert.equal(result.action, "rerun");
  assert.deepEqual(mutations, ["/repos/example/project/actions/runs/42/cancel", "/repos/example/project/actions/runs/42/rerun"]);
});


test("withdrawal controller records a server-timed fence before waking the actual gate", async () => {
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  const calls = [];
  let recorded;
  const request = async (_token, _repository, path, options = {}) => {
    calls.push({ path, method: options.method || "GET", body: options.body });
    if (path.endsWith("/actions/runs/99")) return { path: ".github/workflows/ai-review-rerun.yml@refs/pull/1/merge", head_branch: "feature/example", repository: { full_name: "example/project" }, event: "pull_request_review_comment", pull_requests: [{ number: 1 }], display_title: "AI review evidence:pull_request_review_comment:deleted:1:chatgpt-codex-connector[bot]:false:false:false", created_at: "2026-10-01T10:03:00Z" };
    if (path.endsWith("/pulls/1")) return { state: "open", head: { sha: headSha } };
    if (path.includes("/issues/1/comments") && options.method !== "POST") return recorded ? [recorded] : [];
    if (path.endsWith("/issues/1/comments") && options.method === "POST") return recorded = { body: JSON.parse(options.body).body, user: { login: "github-actions[bot]" }, created_at: "2026-10-01T10:04:00Z" };
    if (path.includes("/workflows/ai-review.yml/runs")) return { workflow_runs: [{ id: 42, event: "pull_request", head_sha: headSha, status: "completed", conclusion: "success" }] };
    if (path.endsWith("/attempts/1")) return { run_started_at: "2026-10-01T10:03:30Z" };
    if (path.endsWith("/rerun")) return null;
    throw new Error(`Unexpected request ${path}`);
  };
  const options = { token: "synthetic", repository: "example/project", runId: 99, defaultBranch: "main", request };
  assert.equal((await recordReviewWithdrawal(options)).action, "rerun");
  assert.equal((await recordReviewWithdrawal({ ...options, request: async (t, r, path, mutation) => {
    const value = await request(t, r, path, mutation);
    return path.endsWith("/actions/runs/99") ? { ...value, event: "issue_comment", head_branch: "main", path: ".github/workflows/ai-review-rerun.yml@main",
      display_title: "AI review evidence:issue_comment:deleted:1:chatgpt-codex-connector[bot]:false:true:false" } : value;
  } })).action, "rerun");
  for (const title of [
    "AI review evidence:issue_comment:edited:1:chatgpt-codex-connector[bot]:false:true:false",
    "AI review evidence:issue_comment:edited:1:chatgpt-codex-connector[bot]:false:false:true",
    "AI review evidence:issue_comment:edited:1:github-actions[bot]:true:false:false"
  ]) {
    assert.equal((await recordReviewWithdrawal({ ...options, request: async (t, r, path, mutation) => {
      const value = await request(t, r, path, mutation);
      return path.endsWith("/actions/runs/99") ? { ...value, event: "issue_comment", head_branch: "main",
        path: ".github/workflows/ai-review-rerun.yml@main", display_title: title } : value;
    } })).action, "rerun");
  }
  assert.match(recorded.body, /"source_created_at":"2026-10-01T10:03:00Z"/);
  assert.match(recorded.body, new RegExp(headSha));
  assert.ok(calls.findIndex((call) => call.method === "POST" && call.path.endsWith("/comments")) < calls.findIndex((call) => call.path.endsWith("/rerun")));
  for (const qualifiedPath of [".github/workflows/ai-review-rerun.yml", ".github/workflows/ai-review-rerun.yml@feature/example", ".github/workflows/ai-review-rerun.yml@refs/heads/feature/example", ".github/workflows/ai-review-rerun.yml@main", ".github/workflows/ai-review-rerun.yml@refs/heads/main"]) {
    assert.equal((await recordReviewWithdrawal({ ...options, request: async (t, r, path, mutation) => {
      const value = await request(t, r, path, mutation);
      return path.endsWith("/actions/runs/99") ? { ...value, path: qualifiedPath } : value;
    } })).action, "rerun");
  }
  assert.equal((await recordReviewWithdrawal(options)).action, "rerun");
  assert.equal(calls.filter((call) => call.method === "POST" && call.path.endsWith("/comments")).length, 1, "duplicate deliveries preserve one durable record");
});

test("withdrawal controller ignores unrelated, forged, or cross-PR run metadata", async () => {
  const base = { path: ".github/workflows/ai-review-rerun.yml@refs/pull/1/merge", head_branch: "feature/example", repository: { full_name: "example/project" }, event: "pull_request_review_comment", pull_requests: [{ number: 1 }], display_title: "AI review evidence:pull_request_review_comment:deleted:1:chatgpt-codex-connector[bot]:false:false:false", created_at: "2026-10-01T10:03:00Z" };
  for (const metadata of [
    { ...base, path: ".github/workflows/untrusted.yml" },
    { ...base, event: "issue_comment", head_branch: "main", display_title: base.display_title.replace("pull_request_review_comment", "issue_comment") },
    { ...base, path: ".github/workflows/ai-review-rerun.yml@wrong-ref" },
    { ...base, path: ".github/workflows/ai-review-rerun.yml@refs/pull/2/merge" },
    { ...base, display_title: base.display_title.replace("chatgpt-codex-connector[bot]", "github-actions[bot]") }, { ...base, repository: { full_name: "other/project" } },
    { ...base, display_title: base.display_title.replace(":deleted:", ":created:") },
    { ...base, display_title: base.display_title.replace("chatgpt-codex-connector[bot]", "untrusted[bot]") },
    { ...base, pull_requests: [{ number: 2 }] }, { ...base, created_at: "invalid" },
    { ...base, event: "issue_comment", head_branch: "untrusted", display_title: base.display_title.replace("pull_request_review_comment", "issue_comment") }
  ]) {
    const calls = [];
    const result = await recordReviewWithdrawal({ token: "synthetic", repository: "example/project", runId: 99, defaultBranch: "main", request: async (_t, _r, path) => { calls.push(path); return metadata; } });
    assert.equal(result.action, "ignored");
    assert.equal(calls.length, 1);
  }
});


test("slow cancellation is force-cancelled and polled before scheduling a fresh attempt", async () => {
  let clock = 0, forced = false;
  const mutations = [];
  const result = await rerunAiReviewForPrHead({ token: "synthetic", repository: "example/project", headSha: "abc", prNumber: 1,
    evidenceUpdatedAt: "2026-10-01T10:01:00Z", maxWaitMs: 0, now: () => clock, sleep: async (ms) => { clock += ms; },
    request: async (_t, _r, path, options = {}) => {
      if (path.endsWith("/pulls/1")) return { state: "open", head: { sha: "abc" } };
      if (path.includes("/workflows/ai-review.yml/runs")) return { workflow_runs: [{ id: 42, event: "pull_request", head_sha: "abc", status: forced ? "completed" : "in_progress", conclusion: forced ? "cancelled" : null }] };
      if (options.method === "POST") {
        mutations.push(path);
        if (path.endsWith("/force-cancel")) forced = true;
        return null;
      }
      throw new Error(`Unexpected request ${path}`);
    }
  });
  assert.equal(result.action, "rerun");
  assert.ok(clock >= 30000);
  assert.deepEqual(mutations, ["/repos/example/project/actions/runs/42/cancel", "/repos/example/project/actions/runs/42/force-cancel", "/repos/example/project/actions/runs/42/rerun"]);
});

test("machine withdrawal mutations wake repair while newly created records cannot recurse", () => {
  for (const action of ["edited", "deleted", "created"]) {
    assert.equal(shouldRouteAiReviewRerunEvent({ action, issue: { pull_request: {}, number: 1 }, comment: { body: '<!-- unicorn-hub:ai-review-withdrawal:v1 {} -->', user: { login: "github-actions[bot]" } } }), action !== "created");
    assert.equal(shouldRouteAiReviewRerunEvent({ action, issue: { pull_request: {}, number: 1 }, comment: { body: "AI Review gate failed", user: { login: "github-actions[bot]" } } }), false);
    assert.equal(shouldRouteAiReviewRerunEvent({ action, issue: { pull_request: {}, number: 1 }, comment: { body: "cleared", user: { login: "github-actions[bot]" } }, changes: { body: { from: '<!-- unicorn-hub:ai-review-withdrawal:v1 {} -->' } } }), action !== "created");
  }
});


test("actual destructive-event router cannot rerun before the durable controller writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-withdrawal-order-"));
  try {
    const eventPath = join(dir, "event.json");
    const preload = join(dir, "fetch.mjs");
    // Any direct API access here would let the router race the independent writer.
    writeFileSync(preload, "globalThis.fetch = async () => { throw new Error('Direct destructive rerun raced the withdrawal writer'); };\n");
    const native = { login: "chatgpt-codex-connector[bot]" };
    const issue = { number: 1, pull_request: {} };
    const events = [
      { action: "deleted", issue, comment: { body: nativeSummary, user: native } },
      { action: "deleted", pull_request: { number: 1 }, comment: { pull_request_review_id: 2, body: "P1 finding", user: native } },
      { action: "edited", issue, comment: { body: "Ordinary reply", user: native }, changes: { body: { from: nativeReceipt } } },
      { action: "edited", issue, comment: { body: nativeReceipt, user: native }, changes: { body: { from: nativeSummary } } },
      { action: "deleted", issue, comment: { body: '<!-- unicorn-hub:ai-review-withdrawal:v1 {} -->', user: { login: "github-actions[bot]" } } },
      { action: "edited", issue, comment: { body: "cleared", user: { login: "github-actions[bot]" } }, changes: { body: { from: '<!-- unicorn-hub:ai-review-withdrawal:v1 {} -->' } } }
    ];
    for (const event of events) {
      writeFileSync(eventPath, JSON.stringify(event));
      const result = spawnSync(process.execPath, ["--import", preload, "scripts/ai-review-rerun.mjs"], { encoding: "utf8",
        env: { ...process.env, GITHUB_TOKEN: "synthetic", GITHUB_REPOSITORY: "example/project", AI_REVIEW_AGENT: "codex",
          GITHUB_EVENT_NAME: event.issue ? "issue_comment" : "pull_request_review_comment", GITHUB_EVENT_PATH: eventPath } });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /deferred: withdrawal controller must persist the fence/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
