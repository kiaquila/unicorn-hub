#!/usr/bin/env node
import { parseArgs, readConfig, findRepoRoot } from "./shared.mjs";
import { discoverRepository, ghApi, responseMessage } from "./github-api.mjs";

function main() {
const args = parseArgs();
const dryRun = Boolean(args["dry-run"]);
const apply = Boolean(args.apply);
if (dryRun === apply) {
  console.error("Choose exactly one mode: --dry-run or --apply.");
  process.exit(2);
}

const root = findRepoRoot();
const config = readConfig(root);
const gh = String(args.gh || "gh");
const repository = discoverRepository(gh, { cwd: root, repo: args.repo });
const repo = repository.repo;
const branch = String(args.branch || repository.defaultBranch || config.defaultBaseBranch || "main");
const checks = String(args.checks || (config.requiredChecks || ["baseline-checks", "guard", "osv-scan", "AI Review"]).join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const freshnessDays = Number(args["check-freshness-days"] || 7);

if (checks.length === 0) {
  console.error("No required checks are configured; refusing to apply branch protection.");
  process.exit(1);
}
if (!Number.isFinite(freshnessDays) || freshnessDays <= 0 || freshnessDays > 30) {
  console.error("--check-freshness-days must be a number from 1 through 30.");
  process.exit(2);
}

function requireOk(response, operation) {
  if (!response.ok) {
    throw new Error(`${operation} failed: ${responseMessage(response)}`);
  }
  return response.json || {};
}

const commit = requireOk(
  ghApi(gh, { path: `/repos/${repo}/commits/${encodeURIComponent(branch)}`, cwd: root }),
  `Reading ${repo}:${branch} head`
);
const sha = String(commit.sha || "").trim();
if (!sha) {
  console.error(`GitHub did not return a head SHA for ${repo}:${branch}.`);
  process.exit(1);
}

const evidenceByCheck = new Map(Object.entries({
  "baseline-checks": { workflow: ".github/workflows/ci.yml", mode: "default-head" },
  "guard": { workflow: ".github/workflows/pr-guard.yml", mode: "pull-request" },
  "osv-scan": { workflow: ".github/workflows/osv-scan.yml", mode: "default-head" },
  "AI Review": { workflow: ".github/workflows/ai-review.yml", mode: "pull-request" },
  ...(config.requiredCheckEvidence || {})
}));
if (args["check-evidence"] !== undefined) {
  let overrides;
  try {
    overrides = JSON.parse(String(args["check-evidence"]));
  } catch {
    console.error("--check-evidence must be a JSON object keyed by check context.");
    process.exit(2);
  }
  for (const [check, evidence] of Object.entries(overrides || {})) evidenceByCheck.set(check, evidence);
}
for (const [check, evidence] of evidenceByCheck) {
  if (!evidence || typeof evidence !== "object" ||
      !/^\.github\/workflows\/[A-Za-z0-9._-]+\.(?:yml|yaml)$/.test(String(evidence.workflow || "")) ||
      !["default-head", "pull-request"].includes(evidence.mode)) {
    console.error(`Invalid required-check evidence for '${check}'. Expected {workflow, mode} with mode default-head or pull-request.`);
    process.exit(2);
  }
}
const workflowByCheck = new Map([...evidenceByCheck].map(([check, evidence]) => [check, evidence.workflow]));
const missingWorkflows = [];
const workflowAvailableSince = new Map();
for (const check of checks) {
  const workflow = workflowByCheck.get(check);
  if (!workflow || workflowAvailableSince.has(workflow)) continue;
  const response = ghApi(gh, {
    path: `/repos/${repo}/contents/${workflow}?ref=${encodeURIComponent(branch)}`,
    cwd: root
  });
  if (response.status === 404) {
    missingWorkflows.push(workflow);
  } else if (!response.ok) {
    throw new Error(`Checking ${workflow} on ${repo}:${branch} failed: ${responseMessage(response)}`);
  } else {
    const history = requireOk(
      ghApi(gh, {
        path: `/repos/${repo}/commits?path=${encodeURIComponent(workflow)}&sha=${encodeURIComponent(branch)}&per_page=1`,
        cwd: root
      }),
      `Reading the default-branch history for ${workflow}`
    );
    const latest = Array.isArray(history) ? history[0] : null;
    const timestamp = Date.parse(String(latest?.commit?.committer?.date || latest?.commit?.author?.date || ""));
    if (!Number.isFinite(timestamp)) {
      throw new Error(`GitHub did not return a commit timestamp for ${workflow} on ${repo}:${branch}.`);
    }
    workflowAvailableSince.set(workflow, timestamp);
  }
}
if (missingWorkflows.length > 0) {
  console.error(`Branch protection was not changed. Required workflow files are not present on ${repo}:${branch}:`);
  for (const workflow of missingWorkflows) console.error(`- ${workflow}`);
  console.error("Merge the installed workflows into the default branch, wait for checks, then retry.");
  process.exit(1);
}

const defaultHeadExisting = new Set();
const pullRequestWorkflowEvidence = new Map();
const defaultHeadWorkflowEvidence = new Map();
const cutoff = Date.now() - freshnessDays * 24 * 60 * 60 * 1000;
for (const workflow of new Set([...workflowByCheck.values()].filter((item) => workflowAvailableSince.has(item)))) {
  const workflowFile = workflow.split("/").at(-1);
  const runsResponse = requireOk(
    ghApi(gh, {
      path: `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=20`,
      cwd: root
    }),
    `Reading recent runs for ${workflow}`
  );
  const availableSince = workflowAvailableSince.get(workflow);
  const candidateRuns = (Array.isArray(runsResponse.workflow_runs) ? runsResponse.workflow_runs : [])
    .filter((run) => {
      const timestamp = Date.parse(String(run.run_started_at || run.created_at || ""));
      return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp >= availableSince;
    });
  pullRequestWorkflowEvidence.set(workflow, new Set());
  defaultHeadWorkflowEvidence.set(workflow, new Set());
  const expectedChecks = checks.filter((check) => workflowByCheck.get(check) === workflow);

  for (const run of candidateRuns) {
    const isDefaultHead = String(run.head_branch || "") === branch && String(run.head_sha || "") === sha;
    if (!isDefaultHead && run.event !== "pull_request") continue;

    const runId = Number(run.id);
    if (!Number.isInteger(runId) || runId <= 0) continue;
    const jobNames = [];
    for (let page = 1; page <= 10; page += 1) {
      const jobs = requireOk(
        ghApi(gh, { path: `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`, cwd: root }),
        `Reading jobs for workflow run ${runId}, page ${page}`
      );
      const pageJobs = Array.isArray(jobs.jobs) ? jobs.jobs : [];
      jobNames.push(...pageJobs.map((job) => String(job.name || "")).filter(Boolean));
      if (pageJobs.length < 100) break;
    }
    for (const name of jobNames) {
      if (isDefaultHead) {
        defaultHeadExisting.add(name);
        defaultHeadWorkflowEvidence.get(workflow).add(name);
      }
    }
    const needsPullEvidence = run.event === "pull_request" && expectedChecks.some((check) =>
      evidenceByCheck.get(check).mode === "pull-request" &&
      jobNames.includes(check) &&
      !pullRequestWorkflowEvidence.get(workflow).has(check)
    );
    if (needsPullEvidence) {
      let associatedPulls = Array.isArray(run.pull_requests) ? run.pull_requests : [];
      if (associatedPulls.length === 0 && run.head_sha) {
        associatedPulls = requireOk(
          ghApi(gh, { path: `/repos/${repo}/commits/${run.head_sha}/pulls`, cwd: root }),
          `Reading pull requests associated with workflow run ${run.id}`
        );
      }
      if (associatedPulls.some((pull) => pull.base?.ref === branch)) {
        for (const name of jobNames) pullRequestWorkflowEvidence.get(workflow).add(name);
      }
    }
    const proven = expectedChecks.every((check) => {
      const evidence = evidenceByCheck.get(check).mode === "default-head"
        ? defaultHeadWorkflowEvidence.get(workflow)
        : pullRequestWorkflowEvidence.get(workflow);
      return evidence.has(check);
    });
    if (proven) break;
  }
}

const customChecks = checks.filter((check) => !workflowByCheck.has(check));
if (customChecks.some((check) => !defaultHeadExisting.has(check))) {
  for (let page = 1; page <= 10; page += 1) {
    const checkRuns = requireOk(
      ghApi(gh, { path: `/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`, cwd: root }),
      `Reading check runs for ${sha}, page ${page}`
    );
    const pageRuns = Array.isArray(checkRuns.check_runs) ? checkRuns.check_runs : [];
    for (const checkRun of pageRuns) {
      if (checkRun.name) defaultHeadExisting.add(String(checkRun.name));
    }
    if (customChecks.every((check) => defaultHeadExisting.has(check)) || pageRuns.length < 100) break;
  }
}
if (customChecks.some((check) => !defaultHeadExisting.has(check))) {
  for (let page = 1; page <= 10; page += 1) {
    const combinedStatus = requireOk(
      ghApi(gh, { path: `/repos/${repo}/commits/${sha}/status?per_page=100&page=${page}`, cwd: root }),
      `Reading commit statuses for ${sha}, page ${page}`
    );
    const statuses = Array.isArray(combinedStatus.statuses) ? combinedStatus.statuses : [];
    for (const status of statuses) {
      if (status.context) defaultHeadExisting.add(String(status.context));
    }
    if (customChecks.every((check) => defaultHeadExisting.has(check)) || statuses.length < 100) break;
  }
}
const missing = checks.filter((check) => {
  const workflow = workflowByCheck.get(check);
  if (!workflow) return !defaultHeadExisting.has(check);
  const evidence = evidenceByCheck.get(check).mode === "default-head"
    ? defaultHeadWorkflowEvidence.get(workflow)
    : pullRequestWorkflowEvidence.get(workflow);
  return !evidence?.has(check);
});

if (missing.length > 0) {
  console.error(`Branch protection was not changed. Required checks lack workflow-proven evidence from the last ${freshnessDays} days:`);
  for (const check of missing) console.error(`- ${check}`);
  console.error("Wait for the installed workflows to run successfully on the default branch, then retry.");
  process.exit(1);
}

const payload = {
  required_status_checks: null,
  enforce_admins: true,
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: Number(args.approvals || 0),
    require_last_push_approval: false
  },
  restrictions: null,
  required_conversation_resolution: true,
  allow_force_pushes: false,
  allow_deletions: false,
  required_linear_history: false
};

const protectionResponse = ghApi(gh, {
  path: `/repos/${repo}/branches/${encodeURIComponent(branch)}/protection`,
  cwd: root
});
let existingProtection = null;
if (protectionResponse.ok) {
  existingProtection = protectionResponse.json || {};
} else if (protectionResponse.status !== 404) {
  throw new Error(`Reading existing branch protection failed: ${responseMessage(protectionResponse)}`);
}

const protectedChecks = new Map();
for (const item of existingProtection?.required_status_checks?.checks || []) {
  if (!item.context) continue;
  protectedChecks.set(String(item.context), {
    context: String(item.context),
    ...(Number.isInteger(item.app_id) ? { app_id: item.app_id } : {})
  });
}
for (const context of existingProtection?.required_status_checks?.contexts || []) {
  if (context && !protectedChecks.has(String(context))) protectedChecks.set(String(context), { context: String(context) });
}
for (const context of checks) {
  if (!protectedChecks.has(context)) protectedChecks.set(context, { context });
}
payload.required_status_checks = {
  strict: Boolean(existingProtection?.required_status_checks?.strict) || args.strict !== "false",
  checks: [...protectedChecks.values()]
};

const existingReviews = existingProtection?.required_pull_request_reviews;
payload.required_pull_request_reviews.require_code_owner_reviews = Boolean(existingReviews?.require_code_owner_reviews);
payload.required_pull_request_reviews.require_last_push_approval = Boolean(existingReviews?.require_last_push_approval);
payload.required_pull_request_reviews.required_approving_review_count = Math.max(
  Number(existingReviews?.required_approving_review_count || 0),
  Number(args.approvals || 0)
);
function actorRestrictions(value) {
  if (!value) return undefined;
  return {
    users: (value.users || []).map((user) => user.login).filter(Boolean),
    teams: (value.teams || []).map((team) => team.slug).filter(Boolean),
    apps: (value.apps || []).map((app) => app.slug).filter(Boolean)
  };
}
const dismissalRestrictions = actorRestrictions(existingReviews?.dismissal_restrictions);
if (dismissalRestrictions) payload.required_pull_request_reviews.dismissal_restrictions = dismissalRestrictions;
const bypassAllowances = actorRestrictions(existingReviews?.bypass_pull_request_allowances);
if (bypassAllowances) payload.required_pull_request_reviews.bypass_pull_request_allowances = bypassAllowances;
if (existingProtection?.restrictions) {
  payload.restrictions = actorRestrictions(existingProtection.restrictions);
}
payload.required_linear_history = Boolean(existingProtection?.required_linear_history?.enabled);
payload.block_creations = Boolean(existingProtection?.block_creations?.enabled);
payload.lock_branch = Boolean(existingProtection?.lock_branch?.enabled);
payload.allow_fork_syncing = Boolean(existingProtection?.allow_fork_syncing?.enabled);

if (dryRun) {
  console.log(`Dry run: all required checks exist in recent runs for ${repo}; default branch is ${branch} at ${sha}.`);
  console.log(`Would apply branch protection without weakening existing controls. Configured checks: ${checks.join(", ")}`);
  process.exit(0);
}

const response = ghApi(gh, {
  method: "PUT",
  path: `/repos/${repo}/branches/${encodeURIComponent(branch)}/protection`,
  body: payload,
  cwd: root
});
if (!response.ok) {
  console.error(`Branch protection failed: ${responseMessage(response)}`);
  process.exit(1);
}

const verifiedProtection = requireOk(
  ghApi(gh, {
    path: `/repos/${repo}/branches/${encodeURIComponent(branch)}/protection`,
    cwd: root
  }),
  "Verifying branch protection after update"
);
const verifiedContexts = new Set([
  ...(verifiedProtection.required_status_checks?.checks || []).map((item) => item.context),
  ...(verifiedProtection.required_status_checks?.contexts || [])
].filter(Boolean));
const verificationFailures = [];
for (const item of payload.required_status_checks.checks) {
  const verifiedCheck = (verifiedProtection.required_status_checks?.checks || [])
    .find((candidate) => candidate.context === item.context);
  if (!verifiedContexts.has(item.context)) {
    verificationFailures.push(`required check '${item.context}'`);
  } else if (Number.isInteger(item.app_id) && verifiedCheck?.app_id !== item.app_id) {
    verificationFailures.push(`required check source '${item.context}'`);
  }
}
if (payload.required_status_checks.strict && !verifiedProtection.required_status_checks?.strict) {
  verificationFailures.push("strict status checks");
}
if (!verifiedProtection.enforce_admins?.enabled) verificationFailures.push("administrator enforcement");
const verifiedReviews = verifiedProtection.required_pull_request_reviews || {};
if (!verifiedReviews.dismiss_stale_reviews) verificationFailures.push("stale-review dismissal");
if (payload.required_pull_request_reviews.require_code_owner_reviews && !verifiedReviews.require_code_owner_reviews) {
  verificationFailures.push("code-owner reviews");
}
if (payload.required_pull_request_reviews.require_last_push_approval && !verifiedReviews.require_last_push_approval) {
  verificationFailures.push("last-push approval");
}
if (Number(verifiedReviews.required_approving_review_count || 0) < payload.required_pull_request_reviews.required_approving_review_count) {
  verificationFailures.push("approval threshold");
}
function actorSetsDiffer(expected, actual) {
  return ["users", "teams", "apps"].some((kind) => {
    const property = kind === "users" ? "login" : "slug";
    const expectedValues = new Set(expected?.[kind] || []);
    const actualValues = new Set((actual?.[kind] || []).map((item) => item[property]).filter(Boolean));
    return expectedValues.size !== actualValues.size || [...expectedValues].some((item) => !actualValues.has(item));
  });
}
if (actorSetsDiffer(payload.required_pull_request_reviews.dismissal_restrictions, verifiedReviews.dismissal_restrictions)) {
  verificationFailures.push("review dismissal restrictions");
}
if (actorSetsDiffer(payload.required_pull_request_reviews.bypass_pull_request_allowances, verifiedReviews.bypass_pull_request_allowances)) {
  verificationFailures.push("review bypass allowances");
}
if (actorSetsDiffer(payload.restrictions, verifiedProtection.restrictions)) {
  verificationFailures.push("push restrictions");
}
if (!verifiedProtection.required_conversation_resolution?.enabled) verificationFailures.push("conversation resolution");
if (verifiedProtection.allow_force_pushes?.enabled) verificationFailures.push("force-push prevention");
if (verifiedProtection.allow_deletions?.enabled) verificationFailures.push("deletion prevention");
for (const [key, label] of [
  ["required_linear_history", "linear history"],
  ["block_creations", "branch-creation blocking"],
  ["lock_branch", "branch lock"],
  ["allow_fork_syncing", "fork syncing"]
]) {
  if (payload[key] && !verifiedProtection[key]?.enabled) verificationFailures.push(label);
}
if (verificationFailures.length > 0) {
  console.error(`GitHub accepted branch protection but postcondition verification failed: ${verificationFailures.join(", ")}`);
  process.exit(1);
}

console.log(`Applied and verified branch protection on ${repo}:${branch} with required checks: ${checks.join(", ")}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
