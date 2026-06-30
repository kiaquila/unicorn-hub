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

function dependabotLabel(ecosystem) {
  return ecosystem === "github-actions" ? "github-actions" : ecosystem;
}

function renderDependabot(updates) {
  const blocks = updates.map((update, index) => {
    const ecosystem = String(update["package-ecosystem"] || update.packageEcosystem || "").trim();
    if (!ecosystem) {
      throw new Error(`dependabotUpdates entry ${index} is missing 'packageEcosystem'`);
    }
    const directory = String(update.directory || "/");
    const interval = String(update.schedule?.interval || "weekly");
    const time = String(update.schedule?.time || "07:00");
    const timezone = String(update.schedule?.timezone || "UTC");
    const label = dependabotLabel(ecosystem);

    const lines = [
      `  - package-ecosystem: "${ecosystem}"`,
      `    directory: "${directory}"`,
      "    schedule:",
      `      interval: "${interval}"`
    ];
    if (interval === "weekly") {
      lines.push(`      day: "${String(update.schedule?.day || "monday")}"`);
    }
    lines.push(
      `      time: "${time}"`,
      `      timezone: "${timezone}"`,
      `    open-pull-requests-limit: ${Number(update.openPullRequestsLimit ?? update["open-pull-requests-limit"] ?? 5)}`,
      "    labels:",
      "      - \"dependencies\"",
      `      - "${label}"`,
      "    commit-message:",
      `      prefix: "${String(update.commitMessage?.prefix || update["commit-message"]?.prefix || "chore")}"`,
      "      include: \"scope\"",
      "    cooldown:",
      `      default-days: ${Number(update.cooldown?.defaultDays ?? update.cooldown?.["default-days"] ?? 7)}`,
      `      semver-major-days: ${Number(update.cooldown?.semverMajorDays ?? update.cooldown?.["semver-major-days"] ?? 14)}`,
      `      semver-minor-days: ${Number(update.cooldown?.semverMinorDays ?? update.cooldown?.["semver-minor-days"] ?? 7)}`,
      `      semver-patch-days: ${Number(update.cooldown?.semverPatchDays ?? update.cooldown?.["semver-patch-days"] ?? 3)}`
    );
    return lines.join("\n");
  });
  return `version: 2\nupdates:\n${blocks.join("\n\n")}\n`;
}

function copyFileFromSource(sourceFile, targetFile, { template = true } = {}) {
  const target = join(targetRoot, targetFile);
  const targetExists = existsSync(target);
  if (targetExists && !force) {
    planned.push({ action: "skip", target: targetFile });
    return "skip";
  }
  const raw = readFileSync(sourceFile, "utf8");
  const content = targetFile === ".github/dependabot.yml" && Array.isArray(profile.dependabotUpdates)
    ? renderDependabot(profile.dependabotUpdates)
    : template ? replacePlaceholders(raw, replacements) : raw;
  const action = targetExists ? "overwrite" : "create";
  planned.push({ action, target: targetFile });
  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return action;
}

const GITATTRIBUTES_MARKER = "# >>> unicorn-hub governance (managed block";
const GITATTRIBUTES_END_MARKER = "# <<< unicorn-hub governance (managed block";

function renderGitattributesBlock(sourceFile, managedScriptTargets = new Set()) {
  return readFileSync(sourceFile, "utf8")
    .split(/\r?\n/)
    .filter((line) => {
      const scriptRule = line.match(/^(scripts\/[^\s]+)\s+linguist-vendored\b/);
      return !scriptRule || managedScriptTargets.has(scriptRule[1]);
    })
    .join("\n")
    .replace(/\s*$/, "\n");
}

function replaceManagedGitattributesBlock(existing, block) {
  const begin = existing.indexOf(GITATTRIBUTES_MARKER);
  const end = existing.indexOf(GITATTRIBUTES_END_MARKER, begin);
  if (begin === -1 || end === -1) return null;
  const nextLine = existing.indexOf("\n", end);
  const endOffset = nextLine === -1 ? existing.length : nextLine + 1;
  return [
    existing.slice(0, begin).replace(/\s*$/, ""),
    block.trimEnd(),
    existing.slice(endOffset).replace(/^\s*/, "")
  ].filter(Boolean).join("\n\n") + "\n";
}

function mergeGitattributes(sourceFile, targetFile, { managedScriptTargets = new Set() } = {}) {
  const block = renderGitattributesBlock(sourceFile, managedScriptTargets);
  const target = join(targetRoot, targetFile);
  if (!existsSync(target)) {
    planned.push({ action: "create", target: targetFile });
    if (!dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, block);
    }
    return;
  }
  const existing = readFileSync(target, "utf8");
  if (existing.includes(GITATTRIBUTES_MARKER)) {
    if (!force) {
      planned.push({ action: "skip", target: targetFile });
      return;
    }
    planned.push({ action: "update", target: targetFile });
    if (!dryRun) {
      writeFileSync(target, replaceManagedGitattributesBlock(existing, block) || existing);
    }
    return;
  }
  planned.push({ action: "merge", target: targetFile });
  if (!dryRun) {
    const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    writeFileSync(target, `${existing}${separator}\n${block}`);
  }
}

const excludeTemplates = new Set(profile.excludeTemplates || []);
for (const rel of walkFiles(join(sourceRoot, "templates"))) {
  if (rel === ".unicorn-hub/config.json") continue;
  if (rel === ".gitattributes") continue;
  if (excludeTemplates.has(rel)) {
    planned.push({ action: "exclude", target: rel });
    continue;
  }
  copyFileFromSource(join(sourceRoot, "templates", rel), rel);
}

const scriptAllowlist = new Set([
  "shared.mjs",
  "check-context-budget.mjs",
  "check-feature-memory.mjs",
  "check-repo-baseline.mjs",
  "resolve-pr-context.mjs",
  "ai-command-policy.mjs",
  "ai-review-helpers.mjs",
  "ai-review-gate.mjs",
  "ai-review-rerun.mjs",
  "new-worktree.mjs",
  "publish-branch.mjs",
  "set-implementation-agent.mjs",
  "switch-review-agent.mjs",
  "apply-branch-protection.mjs"
]);

const managedScriptTargets = new Set();
for (const rel of walkFiles(join(sourceRoot, "scripts"))) {
  if (!scriptAllowlist.has(rel)) continue;
  const action = copyFileFromSource(join(sourceRoot, "scripts", rel), join("scripts", rel), { template: false });
  if (action === "create" || action === "overwrite") {
    managedScriptTargets.add(`scripts/${rel}`);
  }
}

const gitattributesSource = join(sourceRoot, "templates", ".gitattributes");
if (existsSync(gitattributesSource)) {
  mergeGitattributes(gitattributesSource, ".gitattributes", { managedScriptTargets });
}

const config = {
  docsDir: profile.docsDir || "docs_project",
  specsDir: profile.specsDir || "specs",
  productPaths: profile.productPaths || ["src/", "app/"],
  requiredChecks: profile.requiredChecks || ["baseline-checks", "guard", "AI Review"],
  defaultBaseBranch: "main",
  defaultImplementationAgent: "claude",
  defaultReviewAgent: "codex",
  trustedReviewLogins: [],
  trustedReviewLoginsByAgent: {},
  profile: profile.id,
  commands: profile.commands || {},
  excludeTemplates: Array.isArray(profile.excludeTemplates) ? [...profile.excludeTemplates] : []
};

planned.push({ action: existsSync(join(targetRoot, ".unicorn-hub/config.json")) && !force ? "skip" : "create", target: ".unicorn-hub/config.json" });
if (!dryRun && (force || !existsSync(join(targetRoot, ".unicorn-hub/config.json")))) {
  mkdirSync(join(targetRoot, ".unicorn-hub"), { recursive: true });
  writeFileSync(join(targetRoot, ".unicorn-hub/config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

if (!dryRun && profile.packageScripts) {
  const packageJsonPath = join(targetRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = readJson(packageJsonPath);
    const templatePackagePath = join(sourceRoot, "templates", "package.json");
    const templatePackageJson = existsSync(templatePackagePath) ? readJson(templatePackagePath) : {};
    if (!packageJson.packageManager && typeof templatePackageJson.packageManager === "string") {
      packageJson.packageManager = templatePackageJson.packageManager;
    }
    if (!packageJson.engines && templatePackageJson.engines) {
      packageJson.engines = templatePackageJson.engines;
    }
    packageJson.scripts = {
      ...(templatePackageJson.scripts || {}),
      ...(packageJson.scripts || {}),
      ...profile.packageScripts
    };
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    planned.push({ action: "scripts", target: "package.json" });
  } else {
    planned.push({ action: "warn", target: "package.json (missing; profile packageScripts not merged)" });
  }
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
const targetLabel = relative(process.cwd(), targetRoot) || ".";
const wroteSomething = planned.some(item => ["create", "overwrite", "merge", "update", "scripts"].includes(item.action));

if (dryRun) {
  console.log(`Dry run for Unicorn Hub blueprint profile '${profileId}' against ${targetLabel}. Nothing was written. Re-run without --dry-run to apply.`);
} else {
  console.log(`Installed Unicorn Hub blueprint profile '${profileId}' into ${targetLabel}`);
  console.log("Next:");
  if (wroteSomething) {
    console.log("1. Review placeholders in AGENTS.md, CLAUDE.md, docs_project/, and .unicorn-hub/config.json.");
  } else {
    console.log("1. No new files were written. Existing AGENTS.md, CLAUDE.md, docs_project/, and .unicorn-hub/config.json were preserved as-is (their contents were not compared to the blueprint); review them for stale placeholders or re-run with --force to refresh from the blueprint.");
  }
  console.log("2. For a new or under-documented project, ask an agent to follow CREATE-DOCS.md and use docs-minimum.md unless full discovery is needed.");
  console.log("3. Create the first specs/<feature-id>/{spec.md,plan.md,tasks.md}.");
  console.log("4. Run the project preflight, then open a PR.");
}
