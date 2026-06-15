#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { blueprintRoot, parseArgs, walkFiles } from "./shared.mjs";

const args = parseArgs();

function run(commandArgs, label) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: blueprintRoot,
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.status !== 0) {
    console.error(`${label} failed.`);
    process.exit(result.status || 1);
  }
}

function syntaxCheck() {
  const files = walkFiles(blueprintRoot, {
    include: (file) => /^(scripts|tests)\/.+\.mjs$/.test(file)
  });

  let failed = false;

  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", join(blueprintRoot, file)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (result.status !== 0) {
      failed = true;
      process.stderr.write(result.stderr || result.stdout);
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(`Syntax check passed for ${files.length} files.`);
}

if (args["syntax-only"]) {
  syntaxCheck();
  process.exit(0);
}

const testFiles = walkFiles(blueprintRoot, {
  include: (file) => /^(scripts|tests)\/.+\.mjs$/.test(file)
});

run(["scripts/check-feature-memory.mjs", "--worktree"], "Feature memory check");
run(["scripts/check-repo-baseline.mjs"], "Repository baseline check");
run(["scripts/check-context-budget.mjs", "--worktree"], "Context budget check");
run(["scripts/sync-workflows.mjs", "--check"], "Workflow sync check");
syntaxCheck();
run(["scripts/sanitize-blueprint.mjs"], "Sanitizer check");
run(["--test", ...testFiles.filter((file) => file.startsWith("tests/") && file.endsWith(".test.mjs")).map((file) => join(blueprintRoot, file))], "Test suite");

console.log("Preflight passed.");
