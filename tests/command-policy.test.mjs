import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("delayed command marker wakes a success started after the human request but before publication", () => {
  const directory = mkdtempSync(join(tmpdir(), "review-command-policy-"));
  try {
    const head = "0123456789abcdef0123456789abcdef01234567";
    const eventPath = join(directory, "event.json");
    const callsPath = join(directory, "calls.json");
    const preload = join(directory, "fetch.mjs");
    writeFileSync(eventPath, JSON.stringify({ issue: { number: 1, pull_request: {} }, comment: {
      id: 1, body: `@codex review ${head}`, created_at: "2026-10-01T10:00:00Z",
      author_association: "OWNER", user: { login: "synthetic-maintainer", type: "User" }
    } }));
    writeFileSync(preload, `import { writeFileSync } from 'node:fs';
      const calls = [];
      globalThis.fetch = async (url, options = {}) => {
        const path = new URL(url).pathname;
        const method = options.method || 'GET';
        calls.push({ path, method, body: options.body ? JSON.parse(options.body) : null });
        writeFileSync(${JSON.stringify(callsPath)}, JSON.stringify(calls));
        let data;
        if (path.endsWith('/pulls/1')) data = { number: 1, state: 'open', head: { sha: '${head}' } };
        else if (path.endsWith('/issues/1/comments') && method === 'POST') data = { id: 2, created_at: process.env.SYNTHETIC_MISSING_TIME ? undefined : '2026-10-01T10:03:00Z' };
        else if (path.endsWith('/ai-review.yml/runs')) data = { workflow_runs: [{ id: 42, event: 'pull_request', head_sha: '${head}', status: 'completed', conclusion: 'success', run_attempt: 1, created_at: '2026-10-01T09:00:00Z' }] };
        else if (path.endsWith('/attempts/1')) data = { run_started_at: '2026-10-01T10:01:00Z' };
        else if (path.endsWith('/rerun') && method === 'POST') {
          if (process.env.SYNTHETIC_RERUN_FAILURE) return { ok: false, status: 503, statusText: 'Unavailable', text: async () => 'Synthetic rerun failure' };
          data = null;
        }
        else throw new Error('Unexpected command-policy request: ' + path);
        return { ok: true, status: data === null ? 204 : 200, json: async () => data, text: async () => data === null ? '' : JSON.stringify(data) };
      };`);
    const run = (extraEnv = {}) => spawnSync(process.execPath, ["--import", preload, "scripts/ai-command-policy.mjs"], {
      encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "synthetic", GITHUB_REPOSITORY: "synthetic/example", GITHUB_EVENT_PATH: eventPath, ...extraEnv }
    });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const calls = JSON.parse(readFileSync(callsPath, "utf8"));
    assert.equal(calls.filter((call) => call.path.endsWith("/rerun") && call.method === "POST").length, 1);
    const marker = calls.find((call) => call.path.endsWith("/comments") && call.method === "POST").body.body;
    assert.match(marker, /AI_REVIEW_SOURCE_COMMENT_CREATED_AT: 2026-10-01T10:00:00Z/);
    assert.match(result.stdout, /Requested AI Review rerun/);
    const missingTime = run({ SYNTHETIC_MISSING_TIME: "1" });
    assert.equal(missingTime.status, 1);
    assert.match(missingTime.stderr, /marker publication time/);
    const failedRerun = run({ SYNTHETIC_RERUN_FAILURE: "1" });
    assert.equal(failedRerun.status, 1);
    assert.match(failedRerun.stderr, /rerun request failed after marker was recorded/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
