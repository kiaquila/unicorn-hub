#!/usr/bin/env node
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { findRepoRoot, parseArgs, pathMatches, readConfig } from "./shared.mjs";

const args = parseArgs();
const repoRoot = resolve(args.target || findRepoRoot());
const config = readConfig(repoRoot);
const positional = args._ || [];
const inspectWorktree = Boolean(args.worktree);
const baseRef = positional[0] || "origin/main";
const headRef = positional[1] || "HEAD";
const specsDir = config.specsDir || "specs";

function git(commandArgs, options = {}) {
  return execFileSync("git", commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "pipe"]
  }).trim();
}

function changedFiles() {
  if (inspectWorktree) {
    return git(["ls-files", "--modified", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
  }
  return git(["diff", "--name-only", baseRef, headRef]).split("\n").filter(Boolean);
}

function hasFileAtRef(ref, path) {
  if (inspectWorktree || ref === "WORKTREE") {
    return existsSync(join(repoRoot, path));
  }
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:${path}`], {
      cwd: repoRoot,
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

const files = changedFiles();
const productPaths = config.productPaths || ["src/", "app/"];
const productChanges = files.filter((file) => pathMatches(file, productPaths));

if (!productChanges.length) {
  console.log("No configured product paths changed; feature-memory gate passes.");
  process.exit(0);
}

const featureIds = new Set();
for (const file of files) {
  const match = file.match(new RegExp(`^${specsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/([^/]+)\\/`));
  if (match) featureIds.add(match[1]);
}

for (const featureId of featureIds) {
  const required = ["spec.md", "plan.md", "tasks.md"].map((name) => `${specsDir}/${featureId}/${name}`);
  if (required.every((path) => hasFileAtRef(headRef, path))) {
    console.log(`Feature-memory gate passed via ${specsDir}/${featureId}/{spec,plan,tasks}.md`);
    process.exit(0);
  }
}

console.error("Product paths changed without a complete feature-memory update.");
console.error(`Product changes: ${productChanges.join(", ")}`);
console.error(`Touch one ${specsDir}/<feature-id>/ folder with spec.md, plan.md, and tasks.md in the same PR.`);
process.exit(1);
