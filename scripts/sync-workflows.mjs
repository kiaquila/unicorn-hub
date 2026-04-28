#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { blueprintRoot, parseArgs, walkFiles } from "./shared.mjs";

const args = parseArgs();
const checkOnly = Boolean(args.check);
const sourceRoot = join(blueprintRoot, "templates/.github/workflows");
const targetRoot = join(blueprintRoot, ".github/workflows");
const workflows = walkFiles(sourceRoot);
const targetWorkflows = existsSync(targetRoot) ? walkFiles(targetRoot) : [];
const drift = [];

for (const file of workflows) {
  const source = join(sourceRoot, file);
  const target = join(targetRoot, file);

  if (checkOnly) {
    if (!existsSync(target) || readFileSync(source, "utf8") !== readFileSync(target, "utf8")) {
      drift.push(file);
    }
    continue;
  }

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

if (checkOnly) {
  for (const file of targetWorkflows) {
    if (!workflows.includes(file)) {
      drift.push(file);
    }
  }
}

if (checkOnly && drift.length) {
  console.error("Root workflows are out of sync with templates:");
  for (const file of drift) console.error(`- ${file}`);
  console.error("Run `node scripts/sync-workflows.mjs` to refresh generated root workflows.");
  process.exit(1);
}

if (checkOnly) {
  console.log("Root workflows match templates.");
} else {
  console.log(`Synced ${workflows.length} root workflows from templates.`);
}
