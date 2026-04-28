#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { parseArgs } from "./shared.mjs";

const args = parseArgs();
const implementation = String(args.implementation || args.impl || "").trim().toLowerCase();
const review = String(args.review || "").trim().toLowerCase();
const allowedImplementation = new Set(["claude", "codex"]);
const allowedReview = new Set(["codex", "claude", "gemini"]);

if (!allowedImplementation.has(implementation)) {
  console.error("Usage: node scripts/set-implementation-agent.mjs --implementation <claude|codex> [--review <codex|claude|gemini>]");
  process.exit(1);
}

execFileSync("gh", ["variable", "set", "AI_IMPLEMENTATION_AGENT", "--body", implementation], {
  stdio: "inherit"
});
console.log(`Repository variable AI_IMPLEMENTATION_AGENT set to ${implementation}.`);

if (review) {
  if (!allowedReview.has(review)) {
    console.error("Review agent must be one of codex, claude, or gemini.");
    process.exit(1);
  }
  execFileSync("gh", ["variable", "set", "AI_REVIEW_AGENT", "--body", review], {
    stdio: "inherit"
  });
  console.log(`Repository variable AI_REVIEW_AGENT set to ${review}.`);
}
