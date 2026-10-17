import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workflow = readFileSync(".github/workflows/ai-review.yml", "utf8");
const selectSource = workflow.match(/- name: Select trusted gate source[\s\S]*?        run: \|\n([\s\S]*?)\n      - name:/)[1]
  .replace(/^          /gm, "");
const reviewedSha = "0123456789abcdef0123456789abcdef01234567";

function withRepository(check) {
  const dir = mkdtempSync(join(tmpdir(), "review-gate-source-"));
  try {
    const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git(["init", "--initial-branch=main"]);
    git(["-c", "user.name=Synthetic Reviewer", "-c", "user.email=reviewer@example.invalid", "commit", "--allow-empty", "-m", "Synthetic trusted base"]);
    const defaultSha = git(["rev-parse", "HEAD"]);
    const run = (pin) => {
      const output = join(dir, "outputs");
      rmSync(output, { force: true });
      const result = spawnSync("bash", ["-c", selectSource], {
        cwd: dir, encoding: "utf8",
        env: { ...process.env, REVIEW_GATE_PIN: pin, GITHUB_OUTPUT: output }
      });
      return { ...result, output: result.status === 0 ? readFileSync(output, "utf8") : "" };
    };
    check({ run, defaultSha });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("review gate defaults to an immutable checkout of the trusted default branch", () => {
  withRepository(({ run, defaultSha }) => {
    const result = run("");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, `gate_sha=${defaultSha}\n`);
  });
});

test("repository-owned gate promotion is full-SHA pinned and bound to the trusted base", () => {
  withRepository(({ run, defaultSha }) => {
    const result = run(`${defaultSha}:${reviewedSha}`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, `gate_sha=${reviewedSha}\n`);
    for (const pin of [reviewedSha, `main:${reviewedSha}`, `${defaultSha}:refs/pull/1/head`,
      `${defaultSha}:${reviewedSha.slice(0, 10)}`, `${defaultSha}:${reviewedSha}:extra`,
      `${"f".repeat(40)}:${reviewedSha}`, `${defaultSha}:$(touch unsafe-source)`]) {
      const rejected = run(pin);
      assert.notEqual(rejected.status, 0, pin);
      assert.equal(rejected.output, "", pin);
    }
  });
});

test("only the isolated default-branch request job can write; validation fails after request failure", () => {
  const [requestJob, validationJob] = workflow.split("jobs:\n")[1].split("\n  ai-review:\n");
  assert.match(workflow, /permissions:\n  contents: read\n  pull-requests: read\n  issues: read/);
  assert.match(requestJob, /permissions:\n      contents: read\n      pull-requests: write\n      issues: write/);
  assert.match(requestJob, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  assert.doesNotMatch(requestJob, /AI_REVIEW_GATE_PIN|steps.source|pull_request.head|secrets\./);
  assert.doesNotMatch(validationJob, /: write|continue-on-error|secrets\./);
  assert.match(validationJob, /needs: request-review\n    if: \|\n      always\(\)/);
  assert.match(validationJob, /AI_REVIEW_TRIGGER_MODE: skip/);
  assert.match(validationJob, /REVIEW_GATE_PIN: \$\{\{ vars.AI_REVIEW_GATE_PIN \}\}/);
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 3);
  const verifyRequest = validationJob.match(/- name: Verify request job[\s\S]*?        run: \|\n([\s\S]*?)\n      - name:/)[1].replace(/^          /gm, "");
  for (const result of ["success", "skipped", "failure", "cancelled", ""]) {
    const execution = spawnSync("bash", ["-c", verifyRequest], { env: { ...process.env, REQUEST_RESULT: result } });
    assert.equal(execution.status === 0, ["success", "skipped"].includes(result), result);
  }
});
