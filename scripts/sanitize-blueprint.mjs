#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blueprintRoot, isTextFile, parseArgs, walkFiles } from "./shared.mjs";

const args = parseArgs();
const root = resolve(args.target || blueprintRoot);

const forbidden = [
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/ },
  { name: "OpenAI-style secret", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "Private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "AWS ARN", pattern: /arn:aws:[A-Za-z0-9_:/.-]+/ },
  { name: "Cloud instance id", pattern: /\bi-[0-9a-f]{8,17}\b/ },
  { name: "macOS personal absolute path", pattern: /\/Users\/[A-Za-z0-9._-]+/ },
  { name: "Linux personal absolute path", pattern: /\/home\/[A-Za-z0-9._-]+/ },
  { name: "Windows personal absolute path", pattern: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/ },
  { name: "Home-relative personal path", pattern: /~\/[A-Za-z0-9._-]+/ },
  { name: "Private repository URL", pattern: /github\.com[:/][A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git/ },
  { name: "Vercel project identifier", pattern: /\bprj_[A-Za-z0-9]{12,}\b/ },
  { name: "Vercel team identifier", pattern: /\bteam_[A-Za-z0-9]{12,}\b/ },
  { name: "Deployment domain residue", pattern: /\b[A-Za-z0-9-]+\.vercel\.app\b/ }
];

const extraTerms = String(args["forbid-terms"] || process.env.UNICORN_FORBIDDEN_TERMS || "")
  .split(",")
  .map((term) => term.trim())
  .filter(Boolean);

for (const term of extraTerms) {
  forbidden.push({
    name: `Forbidden term '${term}'`,
    pattern: new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
  });
}

const findings = [];

for (const file of walkFiles(root, { include: isTextFile })) {
  const text = readFileSync(join(root, file), "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) {
      findings.push(`${file}: ${rule.name}`);
    }
  }
}

if (findings.length) {
  console.error("Sanitizer found non-portable or secret-like content:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Sanitizer check passed.");
