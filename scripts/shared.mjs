import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const scriptDir = dirname(fileURLToPath(import.meta.url));
export const blueprintRoot = resolve(scriptDir, "..");

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      (args._ ||= []).push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function findRepoRoot(start = process.cwd()) {
  let current = resolve(start);
  while (current !== dirname(current)) {
    if (existsSync(join(current, ".git")) || existsSync(join(current, ".unicorn-hub/config.json"))) {
      return current;
    }
    current = dirname(current);
  }
  throw new Error(`Could not find repository root from ${resolve(start)}. Expected a .git directory or .unicorn-hub/config.json.`);
}

export function readConfig(root = findRepoRoot()) {
  const configPath = join(root, ".unicorn-hub/config.json");
  if (!existsSync(configPath)) {
    return {
      docsDir: "docs_project",
      specsDir: "specs",
      productPaths: ["src/", "app/", "index.html"],
      requiredChecks: ["baseline-checks", "guard", "AI Review"],
      defaultBaseBranch: "main",
      defaultReviewAgent: "codex"
    };
  }
  return readJson(configPath);
}

export function walkFiles(root, options = {}) {
  const ignored = new Set([
    ".git",
    ".claude",
    ".codex",
    ".omc",
    ".omx",
    "node_modules",
    "dist",
    "coverage",
    ".next",
    ".turbo",
    ".vercel"
  ]);
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (ignored.has(entry)) continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        visit(path);
      } else if (stat.isFile()) {
        const rel = relative(root, path).replaceAll("\\", "/");
        if (!options.include || options.include(rel)) files.push(rel);
      }
    }
  };
  visit(root);
  return files.sort();
}

export function isTextFile(path) {
  return /\.(c?js|mjs|json|md|ya?ml|txt|toml|html|css|ts|tsx|jsx|sh|gitignore)$/.test(path) ||
    /^[A-Z_]+$/.test(path) ||
    path.includes(".github/workflows/");
}

export function pathMatches(file, patterns = []) {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/")) return file.startsWith(pattern);
    return file === pattern || file.startsWith(`${pattern}/`);
  });
}

export function replacePlaceholders(text, replacements) {
  let result = text;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(`<${key}>`, value);
  }
  return result;
}
