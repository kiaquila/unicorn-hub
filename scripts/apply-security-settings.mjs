#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRepoRoot, parseArgs } from "./shared.mjs";
import { discoverRepository, ghApi, responseMessage } from "./github-api.mjs";

function main() {
const args = parseArgs();
const dryRun = Boolean(args["dry-run"]);
const apply = Boolean(args.apply);
if (dryRun === apply) {
  console.error("Choose exactly one mode: --dry-run or --apply. Remote GitHub settings are never changed implicitly.");
  process.exit(2);
}

const root = findRepoRoot();
const gh = String(args.gh || "gh");
const repository = discoverRepository(gh, { cwd: root, repo: args.repo });
const repo = repository.repo;
const branch = String(args.branch || repository.defaultBranch);

const definitions = [
  {
    id: "dependabot-alerts",
    label: "Dependabot vulnerability alerts",
    mandatory: true,
    kind: "endpoint",
    readPath: `/repos/${repo}/vulnerability-alerts`,
    writePath: `/repos/${repo}/vulnerability-alerts`,
    enabled: (response) => response.status === 204,
    disabled: (response) => response.status === 404
  },
  {
    id: "dependabot-security-updates",
    label: "Dependabot security updates",
    mandatory: true,
    kind: "endpoint",
    readPath: `/repos/${repo}/automated-security-fixes`,
    writePath: `/repos/${repo}/automated-security-fixes`,
    enabled: (response) => response.status === 204,
    disabled: (response) => response.status === 404
  },
  {
    id: "secret-scanning",
    label: "Secret scanning",
    mandatory: true,
    kind: "repository-setting",
    key: "secret_scanning"
  },
  {
    id: "push-protection",
    label: "Secret scanning push protection",
    mandatory: true,
    kind: "repository-setting",
    key: "secret_scanning_push_protection"
  },
  {
    id: "validity-checks",
    label: "Secret scanning validity checks",
    mandatory: false,
    kind: "repository-setting",
    key: "secret_scanning_validity_checks"
  },
  {
    id: "non-provider-patterns",
    label: "Secret scanning non-provider patterns",
    mandatory: false,
    kind: "repository-setting",
    key: "secret_scanning_non_provider_patterns"
  }
];

function unavailable(response) {
  if (![403, 422].includes(response.status)) return false;
  return /not available|unavailable|not supported|not a permitted key|unknown field|plan|billing|license|advanced security|repository visibility/i.test(
    responseMessage(response)
  );
}

function readRepository() {
  const response = ghApi(gh, { path: `/repos/${repo}`, cwd: root });
  if (!response.ok || !response.json) {
    throw new Error(`Reading repository security state failed: ${responseMessage(response)}`);
  }
  return response.json;
}

function readFeature(definition, repositoryState) {
  if (definition.kind === "repository-setting") {
    const value = repositoryState.security_and_analysis?.[definition.key]?.status;
    return { state: value === "enabled" ? "enabled" : "disabled", response: null };
  }
  const response = ghApi(gh, { path: definition.readPath, cwd: root });
  if (definition.enabled(response)) return { state: "enabled", response };
  if (definition.disabled(response)) return { state: "disabled", response };
  return { state: "failed", response };
}

function enableFeature(definition) {
  if (definition.kind === "endpoint") {
    return ghApi(gh, { method: "PUT", path: definition.writePath, cwd: root });
  }
  return ghApi(gh, {
    method: "PATCH",
    path: `/repos/${repo}`,
    body: { security_and_analysis: { [definition.key]: { status: "enabled" } } },
    cwd: root
  });
}

let repositoryState;
try {
  repositoryState = readRepository();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const outcomes = new Map();
for (const definition of definitions) {
  const current = readFeature(definition, repositoryState);
  if (current.state === "failed") {
    console.error(`[failed] ${definition.label}: ${responseMessage(current.response)}`);
    outcomes.set(definition.id, "failed");
    continue;
  }
  if (current.state === "enabled") {
    console.log(`[unchanged] ${definition.label}: already enabled`);
    outcomes.set(definition.id, "enabled");
    continue;
  }
  if (dryRun) {
    console.log(`[planned] ${definition.label}: would enable`);
    outcomes.set(definition.id, "planned");
    continue;
  }

  const response = enableFeature(definition);
  if (!response.ok) {
    const classification = unavailable(response) ? "unsupported" : "failed";
    console.error(`[${classification}] ${definition.label}: ${responseMessage(response)}`);
    outcomes.set(definition.id, classification);
    continue;
  }

  repositoryState = readRepository();
  const verified = readFeature(definition, repositoryState);
  if (verified.state !== "enabled") {
    console.error(`[failed] ${definition.label}: GitHub accepted the update but the enabled state could not be verified`);
    outcomes.set(definition.id, "failed");
    continue;
  }
  console.log(`[enabled] ${definition.label}: enabled and verified`);
  outcomes.set(definition.id, "enabled");
}

const blockingFailures = definitions.filter((definition) => {
  const outcome = outcomes.get(definition.id);
  return outcome === "failed" || (definition.mandatory && !["enabled", "planned"].includes(outcome));
});
if (blockingFailures.length > 0) {
  console.error("GitHub security activation is incomplete; branch protection was not changed. Required work remains:");
  for (const definition of blockingFailures) {
    console.error(`- ${definition.label} (${outcomes.get(definition.id) || "failed"})`);
  }
  process.exit(1);
}

if (dryRun) {
  console.log(`Dry run: no GitHub settings were changed for ${repo}.`);
} else {
  console.log(`GitHub security activation complete for ${repo}; applying branch protection next.`);
}

const branchScript = join(dirname(fileURLToPath(import.meta.url)), "apply-branch-protection.mjs");
const branchArgs = [
  branchScript,
  dryRun ? "--dry-run" : "--apply",
  "--repo",
  repo,
  "--branch",
  branch,
  "--gh",
  gh
];
for (const key of ["approvals", "strict", "checks", "check-freshness-days", "check-evidence"]) {
  if (args[key] !== undefined) branchArgs.push(`--${key}`, String(args[key]));
}
const branchResult = spawnSync(process.execPath, branchArgs, {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit"
});
if (branchResult.error) {
  console.error(branchResult.error.message);
  process.exit(1);
}
if (branchResult.status !== 0) process.exit(branchResult.status || 1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
