#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findRepoRoot, parseArgs, readConfig } from "./shared.mjs";

const args = parseArgs();
const root = findRepoRoot();
const config = readConfig(root);

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
  })?.trim();
}

const branch = run("git", ["branch", "--show-current"], { capture: true });
if (!branch) {
  console.error("Cannot publish from a detached HEAD.");
  process.exit(1);
}

if (!args["skip-preflight"]) {
  const packageJson = join(root, "package.json");
  if (existsSync(packageJson)) run("pnpm", ["run", "preflight"]);
}

run("git", ["push", "-u", "origin", branch]);

const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { capture: true });
const base = args.base || config.defaultBaseBranch || "main";
const title = args.title || `[agent] ${branch.replace(/^[^/]+\//, "").replaceAll("-", " ")}`;
const body = [
  "## Summary",
  "",
  "- Installs or updates the portable multi-agent development workflow.",
  "",
  "## Validation",
  "",
  args["skip-preflight"] ? "- Preflight skipped by caller." : "- `pnpm run preflight`",
  ""
].join("\n");

const bodyFile = join(tmpdir(), `unicorn-pr-${Date.now()}.md`);
writeFileSync(bodyFile, body);

try {
  const existing = run("gh", ["pr", "view", branch, "--json", "url", "--jq", ".url"], { capture: true });
  console.log(`Existing PR: ${existing}`);
} catch {
  run("gh", [
    "pr",
    "create",
    "--repo",
    repo,
    "--base",
    base,
    "--head",
    branch,
    "--draft",
    "--title",
    title,
    "--body-file",
    bodyFile
  ]);
}
