#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { parseArgs, readConfig, findRepoRoot } from "./shared.mjs";

const args = parseArgs();
const root = findRepoRoot();
const config = readConfig(root);
const branch = args.branch || config.defaultBaseBranch || "main";
const checks = String(args.checks || (config.requiredChecks || ["baseline-checks", "guard", "AI Review"]).join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const repo = args.repo || execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
  cwd: root,
  encoding: "utf8"
}).trim();

const payload = {
  required_status_checks: {
    strict: args.strict !== "false",
    contexts: checks
  },
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

execFileSync("gh", [
  "api",
  "--method",
  "PUT",
  `/repos/${repo}/branches/${branch}/protection`,
  "--input",
  "-"
], {
  input: JSON.stringify(payload),
  encoding: "utf8",
  stdio: ["pipe", "inherit", "inherit"]
});

console.log(`Applied branch protection to ${repo}:${branch}`);
