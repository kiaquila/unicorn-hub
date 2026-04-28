#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  blueprintRoot,
  parseArgs,
  readJson,
  replacePlaceholders,
  walkFiles
} from "./shared.mjs";

const args = parseArgs();
const sourceRoot = resolve(args.source || blueprintRoot);
const targetRoot = resolve(args.target || process.cwd());
const profileId = String(args.profile || "generic");
const profilePath = join(sourceRoot, "profiles", `${profileId}.json`);

if (!existsSync(profilePath)) {
  console.error(`Unknown profile '${profileId}'. Expected ${profilePath}`);
  process.exit(1);
}

const projectName = String(args["project-name"] || basename(targetRoot));
const packageName = projectName
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "") || "project";
const profile = readJson(profilePath);
const force = Boolean(args.force);
const dryRun = Boolean(args["dry-run"]);

const replacements = {
  PROJECT_NAME: projectName,
  PROJECT_SUMMARY: args.summary || "[Add a one-sentence project summary]",
  STACK_SUMMARY: args.stack || profile.description || "[Add stack summary]",
  DEPLOY_TARGET: profile.deploy?.type || "[Add deploy target]",
  OWNER_MODEL: args["owner-model"] || "project-specific",
  PACKAGE_NAME: packageName
};

const planned = [];

function copyFileFromSource(sourceFile, targetFile, { template = true } = {}) {
  const target = join(targetRoot, targetFile);
  if (existsSync(target) && !force) {
    planned.push({ action: "skip", target: targetFile });
    return;
  }
  const raw = readFileSync(sourceFile, "utf8");
  const content = template ? replacePlaceholders(raw, replacements) : raw;
  planned.push({ action: existsSync(target) ? "overwrite" : "create", target: targetFile });
  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

for (const rel of walkFiles(join(sourceRoot, "templates"))) {
  if (rel === ".unicorn-hub/config.json") continue;
  copyFileFromSource(join(sourceRoot, "templates", rel), rel);
}

const scriptAllowlist = new Set([
  "shared.mjs",
  "check-feature-memory.mjs",
  "check-repo-baseline.mjs",
  "resolve-pr-context.mjs",
  "ai-review-helpers.mjs",
  "ai-review-gate.mjs",
  "new-worktree.mjs",
  "publish-branch.mjs",
  "set-implementation-agent.mjs",
  "switch-review-agent.mjs",
  "apply-branch-protection.mjs"
]);

for (const rel of walkFiles(join(sourceRoot, "scripts"))) {
  if (!scriptAllowlist.has(rel)) continue;
  copyFileFromSource(join(sourceRoot, "scripts", rel), join("scripts", rel), { template: false });
}

const config = {
  docsDir: profile.docsDir || "docs_project",
  specsDir: profile.specsDir || "specs",
  productPaths: profile.productPaths || ["src/", "app/"],
  requiredChecks: profile.requiredChecks || ["baseline-checks", "guard", "AI Review"],
  defaultBaseBranch: "main",
  defaultImplementationAgent: "claude",
  defaultReviewAgent: "codex",
  profile: profile.id
};

planned.push({ action: existsSync(join(targetRoot, ".unicorn-hub/config.json")) && !force ? "skip" : "create", target: ".unicorn-hub/config.json" });
if (!dryRun && (force || !existsSync(join(targetRoot, ".unicorn-hub/config.json")))) {
  mkdirSync(join(targetRoot, ".unicorn-hub"), { recursive: true });
  writeFileSync(join(targetRoot, ".unicorn-hub/config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

if (!dryRun && args["copy-profiles"]) {
  cpSync(join(sourceRoot, "profiles"), join(targetRoot, ".unicorn-hub/profiles"), {
    recursive: true,
    force: true
  });
}

for (const item of planned) {
  console.log(`${item.action.padEnd(9)} ${item.target}`);
}

console.log("");
console.log(`Installed Unicorn Hub blueprint profile '${profileId}' into ${relative(process.cwd(), targetRoot) || "."}`);
console.log("Next: review placeholders, run the project preflight, then open a PR.");
