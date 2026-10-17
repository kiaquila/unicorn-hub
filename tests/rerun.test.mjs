import test from "node:test";
import assert from "node:assert/strict";
import {
  rerunAiReviewForPrHead,
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
      assert.equal(shouldRouteAiReviewRerunEvent({ ...event, action: "deleted" }, "codex"), false);
    }
  }
});

function wakeupHarness({ statuses = ["completed"], conclusion = "failure", attemptStart = "2026-10-01T10:00:00Z", heads = ["abc"], maxWaitMs = 1000 } = {}) {
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
    if (options.method === "POST" && path.endsWith("/rerun")) return null;
    throw new Error(`Unexpected request ${path}`);
  };
  return {
    calls,
    run: () => rerunAiReviewForPrHead({ token: "synthetic", repository: "example/project", headSha: "abc", prNumber: 1, evidenceUpdatedAt: "2026-10-01T10:01:00Z", request, sleep: async (ms) => { clock += ms; }, now: () => clock, maxWaitMs })
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

test("active gate timeout is bounded and never loops or blindly reruns", async () => {
  const harness = wakeupHarness({ statuses: ["in_progress"] });
  await assert.rejects(harness.run, /still active/);
  assert.ok(harness.calls.length <= 4);
  assert.equal(harness.calls.filter((call) => call.method === "POST").length, 0);
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
