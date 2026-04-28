#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { parseArgs } from "./shared.mjs";

const args = parseArgs();
const selected = String(args.to || args._?.[0] || "").trim().toLowerCase();
const allowed = new Set(["codex", "claude", "gemini"]);

if (!allowed.has(selected)) {
  console.error("Usage: node scripts/switch-review-agent.mjs --to <codex|claude|gemini>");
  process.exit(1);
}

execFileSync("gh", ["variable", "set", "AI_REVIEW_AGENT", "--body", selected], { stdio: "inherit" });
console.log(`Repository variable AI_REVIEW_AGENT set to ${selected}.`);

if (args.pr) {
  const trigger = selected === "codex" ? "@codex review" : selected === "claude" ? "@claude review once" : "/gemini review";
  execFileSync("gh", ["pr", "comment", String(args.pr), "--body", trigger], { stdio: "inherit" });
  console.log(`Posted trusted review trigger on PR ${args.pr}: ${trigger}`);
}
