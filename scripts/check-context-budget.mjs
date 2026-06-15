#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot, parseArgs, readConfig } from "./shared.mjs";

const DEFAULT_MAX_AGENT_LINES = 60;
const PLACEHOLDER_PATTERN = /<[^>\n]+>|\[[A-Z][A-Z0-9 _-]*\]|\[Add[^\]\n]*\]|\{\{[^}\n]+\}\}|TODO|TBD|NEEDS CLARIFICATION|placeholder/gi;

const args = parseArgs();
const repoRoot = resolve(args.target || findRepoRoot());
const config = readConfig(repoRoot);
const specsDir = config.specsDir || "specs";
const docsDir = config.docsDir || "docs_project";
const maxAgentLines = Number(args["max-agent-lines"] || config.contextBudget?.maxAgentLines || DEFAULT_MAX_AGENT_LINES);
const inspectWorktree = Boolean(args.worktree);
const reportOnly = Boolean(args.report);
const baseRef = args._?.[0] || "origin/main";
const headRef = args._?.[1] || "HEAD";
const issues = [];

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

function changedFiles() {
  try {
    if (inspectWorktree) {
      return git(["ls-files", "--modified", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
    }
    return git(["diff", "--name-only", baseRef, headRef]).split("\n").filter(Boolean);
  } catch {
    return [];
  }
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
    .replace(PLACEHOLDER_PATTERN, " ")
    .replace(/`[^`]*`/g, " ")
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

function validateFeatureMemory(featureIds) {
  for (const featureId of featureIds) {
    const specPath = `${specsDir}/${featureId}/spec.md`;
    const planPath = `${specsDir}/${featureId}/plan.md`;

    if (!existsSync(join(repoRoot, specPath))) {
      issues.push(`${specPath} is required for context substance checks.`);
      continue;
    }
    if (!existsSync(join(repoRoot, planPath))) {
      issues.push(`${planPath} is required for context substance checks.`);
      continue;
    }

    const spec = readText(specPath);
    const plan = readText(planPath);
    requireSubstantiveSection(specPath, spec, "Goal");
    requireSubstantiveSection(specPath, spec, "Acceptance Criteria");
    requireSubstantiveSection(planPath, plan, "Verification");
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

const files = changedFiles();
const featureIds = selectedFeatureIds(files);
const alwaysOnStats = checkAlwaysOnFiles();
validateFeatureMemory(featureIds);

if (reportOnly) {
  console.log(buildReport(alwaysOnStats, files, featureIds));
}

if (issues.length) {
  console.error("Context budget check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Context budget check passed.");
