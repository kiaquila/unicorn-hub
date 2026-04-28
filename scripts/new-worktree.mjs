#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot, parseArgs, readConfig } from "./shared.mjs";

const args = parseArgs();
const root = findRepoRoot();
const config = readConfig(root);
const slug = String(args.slug || args._?.[0] || "").trim();

if (!slug) {
  console.error("Usage: node scripts/new-worktree.mjs --slug <feature-slug>");
  process.exit(1);
}

const safeSlug = slug.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const branch = args.branch || `feature/${safeSlug}`;
const base = args.base || `origin/${config.defaultBaseBranch || "main"}`;
const worktreeDir = resolve(root, ".claude", "worktrees", safeSlug);

mkdirSync(join(root, ".claude", "worktrees"), { recursive: true });
execFileSync("git", ["fetch", "origin", config.defaultBaseBranch || "main"], { cwd: root, stdio: "inherit" });
execFileSync("git", ["worktree", "add", "-b", branch, worktreeDir, base], { cwd: root, stdio: "inherit" });

console.log(`Created worktree ${worktreeDir}`);
console.log(`Branch: ${branch}`);
