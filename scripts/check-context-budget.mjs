#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot, parseArgs, readConfig } from "./shared.mjs";

const DEFAULT_MAX_AGENT_LINES = 60;
const PLACEHOLDER_PATTERN = /<[^>\n]+>|\[[A-Z][A-Z0-9 _-]*\]|\[Add[^\]\n]*\]|\{\{[^}\n]+\}\}|TODO|TBD|NEEDS CLARIFICATION|placeholder/gi;
const BRACKETED_INSTRUCTION_PATTERN = /\[[^\]\n]*(?:command|test|screenshot|diff|manual check|implementation approach|risk and mitigation)[^\]\n]*\]/gi;
const TEMPLATE_BOILERPLATE_PATTERN = /\|\s*acceptance criterion\s*\|\s*evidence\s*\||\|\s*-+\s*\|\s*-+\s*\||negative scenario evidence:/gi;

const args = parseArgs();
const repoRoot = resolve(args.target || findRepoRoot());
const config = readConfig(repoRoot);
const specsDir = config.specsDir || "specs";
const docsDir = config.docsDir || "docs_project";
const maxAgentLines = Number(args["max-agent-lines"] || config.contextBudget?.maxAgentLines || DEFAULT_MAX_AGENT_LINES);
const inspectWorktree = Boolean(args.worktree);
const inspectLocalPreflight = Boolean(args["local-preflight"]);
const reportOnly = Boolean(args.report);
const defaultBaseBranch = config.defaultBaseBranch || "main";
const baseRef = args._?.[0] || `origin/${defaultBaseBranch}`;
const headRef = args._?.[1] || "HEAD";
const issues = [];
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const WORKTREE_SOURCE = { type: "worktree" };

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readText(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function lineCount(text) {
  if (!text) return 0;
  return text.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

function placeholderCount(text) {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].length;
}

function defaultAlwaysOnFiles() {
  if (Array.isArray(config.contextBudget?.alwaysOnFiles)) {
    return config.contextBudget.alwaysOnFiles;
  }
  if (config.blueprint) {
    return ["AGENTS.md", "CLAUDE.md", "templates/AGENTS.md", "templates/CLAUDE.md"];
  }
  return ["AGENTS.md", "CLAUDE.md"];
}

function checkAlwaysOnFiles() {
  const files = defaultAlwaysOnFiles();
  const stats = [];

  for (const file of files) {
    const fullPath = join(repoRoot, file);
    if (!existsSync(fullPath)) {
      stats.push({ file, missing: true });
      continue;
    }
    const content = readText(file);
    const lines = lineCount(content);
    const placeholders = placeholderCount(content);
    stats.push({ file, lines, placeholders });
    if (lines > maxAgentLines) {
      issues.push(`${file} has ${lines} lines; keep always-on agent files at or below ${maxAgentLines} lines.`);
    }
  }

  return stats;
}

function git(commandArgs) {
  return execFileSync("git", commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}

function gitShow(object) {
  return execFileSync("git", ["show", object], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
}

function gitRepositoryExists() {
  return existsSync(join(repoRoot, ".git"));
}

function splitFiles(output) {
  return output.split("\n").filter(Boolean);
}

function uniqueFiles(groups) {
  return [...new Set(groups.flat())].sort();
}

function gitChangedFiles(commandArgs, description) {
  try {
    return splitFiles(git(commandArgs));
  } catch {
    issues.push(`Unable to inspect ${description}: git ${commandArgs.join(" ")} failed.`);
    return [];
  }
}

function changedFileContext(label, files, source) {
  return {
    label,
    files: uniqueFiles([files]),
    source
  };
}

function worktreeChangedFileContexts() {
  const unstagedFiles = gitChangedFiles(["diff", "--name-only"], "unstaged worktree changes");
  const stagedFiles = gitChangedFiles(["diff", "--cached", "--name-only"], "staged worktree changes");
  const untrackedFiles = gitChangedFiles(["ls-files", "--others", "--exclude-standard"], "untracked worktree files");

  return [
    changedFileContext("staged worktree changes", stagedFiles, { type: "index" }),
    changedFileContext("unstaged and untracked worktree changes", uniqueFiles([unstagedFiles, untrackedFiles]), WORKTREE_SOURCE)
  ].filter((context) => context.files.length);
}

function gitCommit(ref) {
  try {
    return git(["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch {
    return null;
  }
}

function localPreflightBaseRef() {
  if (gitCommit(baseRef)) return baseRef;

  const headCommit = gitCommit(headRef);
  const localDefaultCommit = gitCommit(defaultBaseBranch);
  if (localDefaultCommit && localDefaultCommit !== headCommit) return defaultBaseBranch;

  if (gitCommit("HEAD~1")) return "HEAD~1";
  return EMPTY_TREE_SHA;
}

function changedFileContexts() {
  if (!gitRepositoryExists()) {
    return [];
  }
  if (inspectWorktree) return worktreeChangedFileContexts();
  if (inspectLocalPreflight && !gitCommit(headRef)) return worktreeChangedFileContexts();
  const resolvedBaseRef = inspectLocalPreflight && !args._?.[0] ? localPreflightBaseRef() : baseRef;
  const description = `committed changes between ${resolvedBaseRef} and ${headRef}`;
  return [
    changedFileContext(
      description,
      gitChangedFiles(["diff", "--name-only", resolvedBaseRef, headRef], description),
      { type: "git", ref: headRef }
    )
  ].filter((context) => context.files.length);
}

function explicitFeatureIds() {
  const ids = [];
  if (typeof args.feature === "string") ids.push(args.feature);
  if (typeof args.features === "string") {
    ids.push(...args.features.split(",").map((item) => item.trim()).filter(Boolean));
  }
  return ids;
}

function allSpecIds() {
  const root = join(repoRoot, specsDir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((entry) => {
      const path = join(root, entry);
      return statSync(path).isDirectory();
    })
    .sort();
}

function featureIdsFromFiles(files) {
  const escapedSpecsDir = escapeRegExp(specsDir);
  const ids = new Set();
  for (const file of files) {
    const match = file.match(new RegExp(`^${escapedSpecsDir}/([^/]+)/`));
    if (match) ids.add(match[1]);
  }
  return [...ids].sort();
}

function selectedFeatureIds(files) {
  const explicit = explicitFeatureIds();
  if (explicit.length) return explicit;
  if (args["all-specs"]) return allSpecIds();
  return featureIdsFromFiles(files);
}

function shouldInspectChangedFiles() {
  if (inspectWorktree || inspectLocalPreflight || reportOnly) return true;
  return !args["all-specs"] && explicitFeatureIds().length === 0;
}

function sectionBody(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "i");
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start === -1) return "";
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    body.push(lines[index]);
  }
  return body.join("\n").trim();
}

function normalizeSubstance(text) {
  return text
    .replace(TEMPLATE_BOILERPLATE_PATTERN, " ")
    .replace(BRACKETED_INSTRUCTION_PATTERN, " ")
    .replace(PLACEHOLDER_PATTERN, " ")
    .replace(/`([^`]*)`/g, " $1 ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[|#>*_[\]():.,;{}+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSubstance(text) {
  const normalized = normalizeSubstance(text);
  const words = normalized.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) || [];
  const meaningful = words.filter((word) => !/^(ac|sc|fr|ns|id|yes|no|\d+)$/i.test(word));
  return meaningful.join("").length >= 24 && meaningful.length >= 4;
}

function requireSubstantiveSection(file, content, heading) {
  const body = sectionBody(content, heading);
  if (!body) {
    issues.push(`${file} is missing ## ${heading}.`);
    return;
  }
  if (!hasSubstance(body)) {
    issues.push(`${file} has placeholder-only or too-thin ## ${heading} content.`);
  }
}

function readTextFromSource(path, source) {
  if (source.type === "worktree") {
    if (!existsSync(join(repoRoot, path))) return null;
    return readText(path);
  }

  try {
    if (source.type === "index") return gitShow(`:${path}`);
    if (source.type === "git") return gitShow(`${source.ref}:${path}`);
  } catch {
    return null;
  }
  return null;
}

function validateFeatureMemory(featureIds, source = WORKTREE_SOURCE) {
  for (const featureId of featureIds) {
    const specPath = `${specsDir}/${featureId}/spec.md`;
    const planPath = `${specsDir}/${featureId}/plan.md`;
    const spec = readTextFromSource(specPath, source);

    if (spec === null) {
      issues.push(`${specPath} is required for context substance checks.`);
      continue;
    }
    const plan = readTextFromSource(planPath, source);
    if (plan === null) {
      issues.push(`${planPath} is required for context substance checks.`);
      continue;
    }

    requireSubstantiveSection(specPath, spec, "Goal");
    requireSubstantiveSection(specPath, spec, "Acceptance Criteria");
    requireSubstantiveSection(planPath, plan, "Verification");
  }
}

function validateSelectedFeatureMemory(fileContexts, featureIds) {
  if (explicitFeatureIds().length || args["all-specs"]) {
    validateFeatureMemory(featureIds, WORKTREE_SOURCE);
    return;
  }

  for (const context of fileContexts) {
    validateFeatureMemory(featureIdsFromFiles(context.files), context.source);
  }
}

function buildReport(alwaysOnStats, files, featureIds) {
  const lines = ["Agent readiness report", "", "Always-on files:"];
  for (const item of alwaysOnStats) {
    if (item.missing) {
      lines.push(`- ${item.file}: missing`);
    } else {
      lines.push(`- ${item.file}: ${item.lines} lines, ${item.placeholders} placeholders`);
    }
  }

  lines.push("", "Configured context:");
  lines.push(`- docsDir: ${docsDir}`);
  lines.push(`- specsDir: ${specsDir}`);
  lines.push(`- productPaths: ${(config.productPaths || []).join(", ") || "(none)"}`);
  lines.push(`- requiredChecks: ${(config.requiredChecks || []).join(", ") || "(none)"}`);

  const commands = config.commands || {};
  lines.push("", "Configured commands:");
  if (Object.keys(commands).length) {
    for (const [name, command] of Object.entries(commands)) lines.push(`- ${name}: ${command}`);
  } else {
    lines.push("- (none)");
  }

  lines.push("", "Changed context:");
  lines.push(`- changed files: ${files.length}`);
  lines.push(`- changed feature folders: ${featureIds.length ? featureIds.join(", ") : "(none)"}`);
  return lines.join("\n");
}

const fileContexts = shouldInspectChangedFiles() ? changedFileContexts() : [];
const files = uniqueFiles(fileContexts.map((context) => context.files));
const featureIds = selectedFeatureIds(files);
const alwaysOnStats = checkAlwaysOnFiles();
validateSelectedFeatureMemory(fileContexts, featureIds);

if (reportOnly) {
  console.log(buildReport(alwaysOnStats, files, featureIds));
}

if (issues.length) {
  console.error("Context budget check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Context budget check passed.");
