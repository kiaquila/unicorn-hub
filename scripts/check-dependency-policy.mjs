#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, sep, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findRepoRoot, parseArgs, readConfig } from "./shared.mjs";

const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org/";
const OFFICIAL_PYTHON_INDEX = "https://pypi.org/simple";
const PYTHON_PROFILES = new Set(["python-service", "telegram-bot"]);
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies"
];
const INSTALL_SCRIPT_NAMES = ["preinstall", "install", "postinstall"];

// This deliberately small set protects common high-value spellings without
// turning the blueprint into a package popularity or reputation database.
export const DEFAULT_PROTECTED_PACKAGE_NAMES = Object.freeze([
  "axios",
  "eslint",
  "express",
  "jest",
  "lodash",
  "next",
  "prettier",
  "react",
  "react-dom",
  "typescript",
  "vite",
  "webpack"
]);

const CONFUSABLES = new Map(Object.entries({
  "а": "a", "Α": "a", "α": "a",
  "с": "c", "ϲ": "c",
  "е": "e", "Ε": "e", "ε": "e",
  "і": "i", "Ι": "i", "ι": "i",
  "ј": "j",
  "о": "o", "Ο": "o", "ο": "o",
  "р": "p", "Ρ": "p", "ρ": "p",
  "ѕ": "s",
  "х": "x", "Χ": "x", "χ": "x",
  "у": "y", "Υ": "y",
  "κ": "k", "ν": "v", "τ": "t"
}));

function normalizeUrl(value) {
  try {
    const url = new URL(String(value));
    url.hash = "";
    url.search = "";
    return url.href.replace(/\/+$/, "/");
  } catch {
    return "";
  }
}

function configuredMinimumReleaseAge(nodePolicy) {
  const value = Number(nodePolicy.minimumReleaseAgeMinutes ?? 10080);
  return Number.isSafeInteger(value) && value >= 10080 ? value : 10080;
}

function configuredRegistryTimeout(nodePolicy) {
  const value = Number(nodePolicy.registryTimeoutMilliseconds ?? 10000);
  if (!Number.isSafeInteger(value)) return 10000;
  return Math.min(30000, Math.max(1000, value));
}

function repositoryPath(root, value) {
  const candidate = String(value || "");
  if (!candidate || isAbsolute(candidate)) return null;
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, candidate);
  if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) return null;
  return resolvedPath;
}

function repositoryRegularFile(root, value) {
  const candidate = String(value || "").replaceAll("\\", "/");
  const path = repositoryPath(root, candidate);
  if (!path || candidate === ".git" || candidate.startsWith(".git/") ||
      candidate === ".gate-trusted" || candidate.startsWith(".gate-trusted/")) return null;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const realRoot = realpathSync(root);
    const realPath = realpathSync(path);
    if (realPath !== resolve(realRoot, candidate)) return null;
    return path;
  } catch {
    return null;
  }
}

function yamlScalar(value) {
  const trimmed = String(value).trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

export function parseWorkspacePolicy(text) {
  const result = { allowBuilds: new Map() };
  const lines = String(text).split(/\r?\n/);
  let inAllowBuilds = false;

  for (const line of lines) {
    if (/^allowBuilds:\s*\{\s*\}\s*(?:#.*)?$/.test(line)) {
      inAllowBuilds = false;
      result.allowBuildsDeclared = true;
      continue;
    }
    if (/^allowBuilds:\s*(?:#.*)?$/.test(line)) {
      inAllowBuilds = true;
      result.allowBuildsDeclared = true;
      continue;
    }
    if (inAllowBuilds) {
      const entry = line.match(/^ {2}(\S.+?):\s*(true|false)\s*(?:#.*)?$/);
      if (entry) {
        result.allowBuilds.set(yamlScalar(entry[1]), entry[2] === "true");
        continue;
      }
      if (/^\S/.test(line) && line.trim()) inAllowBuilds = false;
    }

    const scalar = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*([^#]*?)\s*(?:#.*)?$/);
    if (!scalar) continue;
    const [, key, rawValue] = scalar;
    const value = yamlScalar(rawValue);
    if (value === "true" || value === "false") result[key] = value === "true";
    else if (/^\d+$/.test(value)) result[key] = Number(value);
    else result[key] = value;
  }
  return result;
}

export function validateWorkspacePolicy(text, minimumReleaseAgeMinutes = 10080) {
  const lines = String(text).split(/\r?\n/);
  const uncommented = lines.map((line) => line.replace(/(^|\s)#.*$/, "$1").trimEnd());
  const policy = parseWorkspacePolicy(text);
  const errors = [];
  if (uncommented.some((line) => /^\S/.test(line) && line.trim() &&
      !/^[A-Za-z][A-Za-z0-9]*:/.test(line))) {
    errors.push("top-level workspace keys must use canonical unquoted mapping syntax");
  }
  if (uncommented.some((line) => /^\s*<<\s*:/.test(line))) {
    errors.push("YAML merge keys are not supported in security policy");
  }
  if (uncommented.some((line) => /!!/.test(line))) {
    errors.push("explicit YAML type tags are not supported in security policy");
  }
  const forbiddenKeys = [
    "minimumReleaseAgeExclude",
    "trustPolicyExclude",
    "trustPolicyIgnoreAfter",
    "onlyBuiltDependencies",
    "onlyBuiltDependenciesFile",
    "ignoredBuiltDependencies",
    "neverBuiltDependencies",
    "httpProxy",
    "httpsProxy",
    "proxy",
    "noProxy",
    "noproxy",
    "pnprServer",
    "namedRegistries"
  ];
  for (const key of forbiddenKeys) {
    if (uncommented.some((line) => new RegExp(`^${key}:`).test(line))) {
      errors.push(`${key} is not supported by the portable dependency policy`);
    }
  }
  if (uncommented.some((line) => /^registries:/.test(line))) {
    errors.push("workspace registries are not supported; use the official npm registry");
  }
  const registryLines = uncommented.filter((line) => /^registry:/.test(line));
  if (registryLines.length > 1 || registryLines.some((line) =>
    normalizeUrl(yamlScalar(line.slice(line.indexOf(":") + 1))) !== normalizeUrl(OFFICIAL_NPM_REGISTRY))) {
    errors.push("workspace registry must be the official npm registry");
  }
  const allowBuildDeclarations = uncommented.filter((line) => /^allowBuilds:/.test(line));
  if (allowBuildDeclarations.length !== 1) errors.push("allowBuilds must be declared exactly once");
  for (const key of ["minimumReleaseAge", "blockExoticSubdeps", "trustPolicy", "strictDepBuilds"]) {
    if (uncommented.filter((line) => new RegExp(`^${key}:`).test(line)).length !== 1) {
      errors.push(`${key} must be declared exactly once`);
    }
  }
  const globalBuildLines = uncommented.filter((line) => /^dangerouslyAllowAllBuilds:/.test(line));
  if (globalBuildLines.some((line) => line.trim() !== "dangerouslyAllowAllBuilds: false")) {
    errors.push("dangerouslyAllowAllBuilds must be canonical false when declared");
  }
  let inAllowBuilds = false;
  for (const line of uncommented) {
    if (/^allowBuilds:\s*\{\s*\}\s*$/.test(line)) {
      inAllowBuilds = false;
      continue;
    }
    if (/^allowBuilds:\s*$/.test(line)) {
      inAllowBuilds = true;
      continue;
    }
    if (!inAllowBuilds || !line.trim()) continue;
    if (/^\S/.test(line)) {
      inAllowBuilds = false;
      continue;
    }
    if (!/^ {2}\S.+?:\s*(?:true|false)\s*$/.test(line)) {
      errors.push("allowBuilds entries must use canonical true/false scalars without YAML indirection");
    }
  }
  if (!Number.isFinite(policy.minimumReleaseAge) || policy.minimumReleaseAge < minimumReleaseAgeMinutes) {
    errors.push(`minimumReleaseAge must be at least ${minimumReleaseAgeMinutes} minutes`);
  }
  if (policy.blockExoticSubdeps !== true) errors.push("blockExoticSubdeps must be true");
  if (policy.trustPolicy !== "no-downgrade") errors.push("trustPolicy must be no-downgrade");
  if (policy.strictDepBuilds !== true) errors.push("strictDepBuilds must be true");
  if (!policy.allowBuildsDeclared) errors.push("allowBuilds must be declared explicitly");
  for (const [matcher, allowed] of policy.allowBuilds) {
    if (allowed && !isVersionScopedMatcher(matcher)) {
      errors.push(`allowBuilds entry '${matcher}' must include an exact version`);
    }
  }
  return { policy, errors };
}

function isVersionScopedMatcher(matcher) {
  const value = String(matcher);
  const separator = value.lastIndexOf("@");
  if (separator <= 0) return false;
  return isExactVersion(value.slice(separator + 1));
}

function splitVersionScopedMatcher(matcher) {
  const value = String(matcher);
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || !isExactVersion(value.slice(separator + 1))) return null;
  return { name: value.slice(0, separator), version: value.slice(separator + 1).replace(/^v/, "") };
}

export function isExactVersion(value) {
  return /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(value));
}

export function classifyDependencySpecifier(specifier) {
  const value = String(specifier).trim();
  if (!value) return { allowed: false, reason: "empty dependency specifier" };
  if (/^(?:git(?:\+|:)|github:|gitlab:|bitbucket:|https?:|file:|link:|workspace:|portal:|patch:|path:|npm:)/i.test(value)) {
    return { allowed: false, reason: "Git, URL, alias, or local dependency sources are forbidden" };
  }
  if (/^(?:\.{1,2}\/|~\/|\/)/.test(value)) {
    return { allowed: false, reason: "local dependency paths are forbidden" };
  }
  if (/\.(?:tgz|tar|tar\.gz|zip|gz)(?:[#?].*)?$/i.test(value)) {
    return { allowed: false, reason: "tarball and archive dependency sources are forbidden" };
  }
  if (!/^[0-9A-Za-z*^~<>=|.\-+\s]+$/.test(value)) {
    return { allowed: false, reason: "dependency specifier is not a supported registry range or tag" };
  }
  return { allowed: true };
}

function packageScope(name) {
  const match = String(name).match(/^(@[^/]+)\/(.+)$/);
  return match ? { scope: match[1], leaf: match[2] } : { scope: "", leaf: String(name) };
}

export function confusableSkeleton(value) {
  return String(value)
    .normalize("NFKC")
    .split("")
    .map((character) => CONFUSABLES.get(character) || character)
    .join("")
    .toLowerCase();
}

export function damerauLevenshtein(left, right) {
  const a = [...String(left)];
  const b = [...String(right)];
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let index = 0; index <= a.length; index += 1) matrix[index][0] = index;
  for (let index = 0; index <= b.length; index += 1) matrix[0][index] = index;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost
      );
      if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + 1);
      }
    }
  }
  return matrix[a.length][b.length];
}

export function findSuspiciousName(name, protectedNames = DEFAULT_PROTECTED_PACKAGE_NAMES) {
  const raw = String(name);
  const skeleton = confusableSkeleton(raw);
  if (!/^[\x00-\x7F]+$/.test(raw)) {
    return { kind: "unicode", message: `package name '${raw}' contains non-ASCII or confusable Unicode characters` };
  }
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(raw)) {
    return { kind: "invalid", message: `package name '${raw}' is not a canonical npm registry name` };
  }

  const candidate = packageScope(skeleton);
  for (const protectedName of protectedNames) {
    const protectedPackage = packageScope(confusableSkeleton(protectedName));
    if (skeleton === confusableSkeleton(protectedName)) continue;
    if (Boolean(candidate.scope) !== Boolean(protectedPackage.scope)) continue;
    const comparableCandidate = candidate.scope === protectedPackage.scope
      ? candidate.leaf
      : `${candidate.scope}/${candidate.leaf}`;
    const comparableProtected = candidate.scope === protectedPackage.scope
      ? protectedPackage.leaf
      : `${protectedPackage.scope}/${protectedPackage.leaf}`;
    if (Math.min(comparableCandidate.length, comparableProtected.length) < 4) continue;
    if (Math.abs(comparableCandidate.length - comparableProtected.length) > 1) continue;
    if (damerauLevenshtein(comparableCandidate, comparableProtected) === 1) {
      return {
        kind: "similar",
        protectedName,
        message: `package name '${raw}' is one edit or adjacent transposition from protected name '${protectedName}'`
      };
    }
  }
  return null;
}

export function hasTyposquatException(exceptions, packageName, version) {
  return Array.isArray(exceptions) && exceptions.some((entry) =>
    entry && entry.package === packageName && entry.version === version &&
    isExactVersion(entry.version) && typeof entry.reason === "string" && entry.reason.trim().length > 0
  );
}

function typosquatException(exceptions, packageName, version) {
  return Array.isArray(exceptions) ? exceptions.find((entry) =>
    entry && entry.package === packageName && entry.version === version &&
    isExactVersion(entry.version) && typeof entry.reason === "string" && entry.reason.trim().length > 0
  ) : undefined;
}

function collectDirectDependencies(manifest = {}) {
  const collected = new Map();
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, specifier] of Object.entries(manifest?.[field] || {})) {
      collected.set(`${field}\0${name}`, { name, specifier: String(specifier), field });
    }
  }
  return collected;
}

export function changedDirectDependencies(baseManifest = {}, headManifest = {}) {
  const base = collectDirectDependencies(baseManifest);
  const head = collectDirectDependencies(headManifest);
  return [...head.values()].filter((entry) => {
    const previous = base.get(`${entry.field}\0${entry.name}`);
    return !previous || previous.specifier !== entry.specifier || previous.field !== entry.field;
  });
}

export function parsePnpmLockImporters(text) {
  const resolutions = new Map();
  let importer = null;
  let field = null;
  let packageName = null;
  let inImporters = false;

  for (const line of String(text).split(/\r?\n/)) {
    if (line === "importers:") {
      inImporters = true;
      continue;
    }
    if (!inImporters) continue;
    if (/^\S/.test(line) && line.trim()) break;

    const importerMatch = line.match(/^ {2}(\S.*):\s*$/);
    if (importerMatch) {
      importer = yamlScalar(importerMatch[1]);
      field = null;
      packageName = null;
      continue;
    }
    const fieldMatch = line.match(/^ {4}(dependencies|devDependencies|optionalDependencies|peerDependencies):\s*$/);
    if (fieldMatch) {
      field = fieldMatch[1];
      packageName = null;
      continue;
    }
    const packageMatch = line.match(/^ {6}(\S.*):\s*$/);
    if (packageMatch && importer && field) {
      packageName = yamlScalar(packageMatch[1]);
      continue;
    }
    const versionMatch = line.match(/^ {8}version:\s*(.+?)\s*$/);
    if (versionMatch && importer && field && packageName) {
      let version = yamlScalar(versionMatch[1]);
      version = version.replace(/\(.+\)$/, "");
      resolutions.set(`${importer}\0${field}\0${packageName}`, version);
    }
  }
  return resolutions;
}

function importerForManifest(path) {
  const directory = dirname(path).replaceAll("\\", "/");
  return directory === "." ? "." : directory;
}

function resolveExactVersion(entry, manifestPath, lockResolutions) {
  const locked = lockResolutions.get(`${importerForManifest(manifestPath)}\0${entry.field}\0${entry.name}`);
  if (locked && isExactVersion(locked)) return locked.replace(/^v/, "");
  if (isExactVersion(entry.specifier)) return entry.specifier.replace(/^v/, "");
  return "";
}

function lockedResolution(entry, manifestPath, lockResolutions) {
  return lockResolutions.get(`${importerForManifest(manifestPath)}\0${entry.field}\0${entry.name}`) || "";
}

export function validateLockfileRegistries(text) {
  const errors = [];
  const seen = new Set();
  for (const match of String(text).matchAll(/https?:\/\/[^\s'"}\],)]+/gi)) {
    const raw = match[0];
    let allowed = false;
    try {
      const url = new URL(raw);
      allowed = url.protocol === "https:" && url.hostname === "registry.npmjs.org" &&
        !url.username && !url.password && (!url.port || url.port === "443");
    } catch {
      allowed = false;
    }
    if (!allowed && !seen.has(raw)) {
      seen.add(raw);
      errors.push("pnpm-lock.yaml contains a non-official package source");
    }
  }
  const exotic = String(text).split(/\r?\n/).find((line) => {
    if (/(?:^|[\s[{,])(?:git(?:\+[^:]+)?:|git@|ssh:|github:|gitlab:|bitbucket:|file:|link:|portal:|patch:|path:)/i.test(line)) {
      return true;
    }
    const tarball = line.match(/tarball:\s*([^\s},]+)/i);
    return tarball && !/^https:\/\/registry\.npmjs\.org\//i.test(tarball[1]);
  });
  if (exotic) errors.push("pnpm-lock.yaml contains a Git, local, patched, or archive package source");
  return errors;
}

export function parseNpmrc(text) {
  const registries = {
    default: OFFICIAL_NPM_REGISTRY,
    scopes: new Map(),
    unsafeSettings: [],
    unsafePolicySettings: []
  };
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const key = line.split("=", 1)[0].trim().toLowerCase();
    if (["proxy", "http-proxy", "https-proxy", "noproxy", "no-proxy", "pnpr-server"].includes(key)) {
      registries.unsafeSettings.push(key);
    }
    const normalizedKey = key.replace(/[-_.\[\]]/g, "");
    if ([
      "dangerouslyallowallbuilds",
      "allowbuilds",
      "onlybuiltdependencies",
      "onlybuiltdependenciesfile",
      "ignoredbuiltdependencies",
      "neverbuiltdependencies",
      "strictdepbuilds",
      "blockexoticsubdeps",
      "minimumreleaseage",
      "minimumreleaseageexclude",
      "trustpolicy",
      "trustpolicyexclude",
      "trustpolicyignoreafter"
    ].includes(normalizedKey)) {
      registries.unsafePolicySettings.push(key);
    }
    const match = line.match(/^(@[^:]+:)?registry\s*=\s*(.+)$/i);
    if (!match) continue;
    const value = match[2].trim();
    if (match[1]) registries.scopes.set(match[1].slice(0, -1), value);
    else registries.default = value;
  }
  return registries;
}

function registryForPackage(name, npmrc) {
  const scope = packageScope(name).scope;
  return normalizeUrl((scope && npmrc.scopes.get(scope)) || npmrc.default || OFFICIAL_NPM_REGISTRY);
}

export function validateHashedRequirements(text, allowedIndexes = [OFFICIAL_PYTHON_INDEX]) {
  const errors = [];
  const logicalLines = [];
  let current = "";
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    current += `${current ? " " : ""}${line.replace(/\\\s*$/, "").trim()}`;
    if (!/\\\s*$/.test(line)) {
      logicalLines.push(current);
      current = "";
    }
  }
  if (current) logicalLines.push(current);
  if (logicalLines.length === 0) errors.push("requirements lock is empty");

  const normalizedIndexes = new Set(allowedIndexes.map((value) => normalizeUrl(value)));
  for (const [indexNumber, line] of logicalLines.entries()) {
    const entryLabel = `requirements entry ${indexNumber + 1}`;
    const index = line.match(/^--(?:extra-)?index-url\s+(.+)$/);
    if (index) {
      if (!normalizedIndexes.has(normalizeUrl(index[1]))) errors.push(`${entryLabel} declares an unknown Python index`);
      continue;
    }
    if (line.startsWith("--")) {
      errors.push(`${entryLabel} uses an unsupported requirements option`);
      continue;
    }
    if (/(?:git\+|https?:\/\/|file:|\.\.\/|\.\/)/i.test(line)) {
      errors.push(`${entryLabel} uses a forbidden non-registry Python dependency`);
      continue;
    }
    const exactPin = line.match(/^[A-Za-z0-9_.-]+(?:\[[^\]]+\])?==([^\s;]+)(?:\s|$)/);
    if (!exactPin || exactPin[1].includes("*") || exactPin[1].includes(",")) {
      errors.push(`${entryLabel} must use an exact == pin`);
    }
    if (!/--hash=sha256:[a-fA-F0-9]{64}(?:\s|$)/.test(line)) {
      errors.push(`${entryLabel} is missing a sha256 hash`);
    }
  }
  return errors;
}

function git(root, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function jsonAtRef(root, ref, path) {
  const content = git(root, ["show", `${ref}:${path}`], { allowFailure: true });
  if (content === null) return {};
  return JSON.parse(content);
}

function manifestPathsAtRef(root, ref) {
  const output = git(root, ["ls-tree", "-r", "--name-only", ref]);
  return output.split(/\r?\n/).filter((path) => basename(path) === "package.json");
}

function textAtRef(root, ref, path) {
  return git(root, ["show", `${ref}:${path}`], { allowFailure: true });
}

function runFrozenLockCheck(root, runCommand = execFileSync) {
  if (!existsSync(join(root, "pnpm-lock.yaml"))) {
    return ["pnpm-lock.yaml is required; dependency installation was not verified"];
  }
  try {
    runCommand("pnpm", [
      "install",
      "--lockfile-only",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--ignore-pnpmfile"
    ], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return [];
  } catch (error) {
    return ["pnpm lockfile is missing or stale; frozen verification failed"];
  }
}

function uvIndexErrors(root, allowedIndexes) {
  const errors = [];
  const normalized = new Set(allowedIndexes.map((value) => normalizeUrl(value)));
  const uvLock = readFileSync(join(root, "uv.lock"), "utf8");
  for (const match of uvLock.matchAll(/registry\s*=\s*["']([^"']+)["']/g)) {
    if (!normalized.has(normalizeUrl(match[1]))) errors.push("unknown Python index in uv.lock");
  }
  for (const match of uvLock.matchAll(/^\s*source\s*=\s*\{([^}]*)\}\s*$/gm)) {
    const source = match[1].trim();
    if (/^registry\s*=/.test(source)) continue;
    if (/^(?:editable|virtual)\s*=\s*["']\.["']$/.test(source)) continue;
    errors.push("uv.lock contains a forbidden Git, URL, or local dependency source");
  }

  const pyproject = readFileSync(join(root, "pyproject.toml"), "utf8");
  let inUvIndex = false;
  let inUvSources = false;
  for (const line of pyproject.split(/\r?\n/)) {
    if (/^\s*\[\[tool\.uv\.index\]\]\s*$/.test(line)) {
      inUvIndex = true;
      inUvSources = false;
      continue;
    }
    if (/^\s*\[tool\.uv\.sources\]\s*$/.test(line)) {
      inUvSources = true;
      inUvIndex = false;
      continue;
    }
    if (/^\s*\[/.test(line)) {
      inUvIndex = false;
      inUvSources = false;
    }
    if (/@\s*(?:git\+|https?:\/\/|file:|\.{0,2}\/)/i.test(line)) {
      errors.push("pyproject.toml contains a forbidden direct Git, URL, or local dependency");
    }
    if (inUvSources && /\b(?:git|url|path|workspace)\s*=/.test(line)) {
      errors.push("pyproject.toml contains a forbidden tool.uv.sources dependency");
    }
    if (!inUvIndex) continue;
    const match = line.match(/^\s*url\s*=\s*["']([^"']+)["']/);
    if (match && !normalized.has(normalizeUrl(match[1]))) errors.push("unknown Python index in pyproject.toml");
  }
  return errors;
}

function pythonPolicyEnabled(config) {
  return PYTHON_PROFILES.has(config.profile) || config.dependencyPolicy?.python?.enabled === true;
}

export function validatePythonContract(root, config, runCommand = execFileSync) {
  const pythonPolicy = config.dependencyPolicy?.python || {};
  const enabled = pythonPolicyEnabled(config);
  if (!enabled) return [];

  const errors = [];
  const allowedIndexes = [OFFICIAL_PYTHON_INDEX];
  if (existsSync(join(root, "uv.lock"))) {
    if (!repositoryRegularFile(root, "uv.lock") || !repositoryRegularFile(root, "pyproject.toml")) {
      return ["uv.lock and pyproject.toml must be regular, non-symlink repository files"];
    }
    errors.push(...uvIndexErrors(root, allowedIndexes));
    if (errors.length > 0) return errors;
    try {
      runCommand("uv", ["lock", "--check"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      const detail = String(error?.stderr || error?.stdout || error?.message || "").trim();
      errors.push(`uv lock was not verified as current${detail ? `: ${detail}` : ""}`);
    }
    return errors;
  }

  const lockFile = String(pythonPolicy.requirementsLockFile || "requirements.lock");
  const pathCandidate = repositoryPath(root, lockFile);
  if (!pathCandidate) return ["requirementsLockFile must be a repository-relative file path"];
  if (!existsSync(pathCandidate)) {
    return [`Python dependency policy requires uv.lock or hashed ${lockFile}`];
  }
  const lockPath = repositoryRegularFile(root, lockFile);
  if (!lockPath) return ["requirementsLockFile must be a regular, non-symlink repository file outside trusted control paths"];
  errors.push(...validateHashedRequirements(readFileSync(lockPath, "utf8"), allowedIndexes));
  const installCommand = String(config.commands?.install || "");
  if (!installCommand.includes("--isolated") ||
      !installCommand.includes(`--index-url ${OFFICIAL_PYTHON_INDEX}`) ||
      !installCommand.includes("--require-hashes") ||
      !installCommand.includes("--only-binary :all:")) {
    errors.push("hashed Python installs must use isolated pip, the official index, --require-hashes, and --only-binary :all:");
  }
  return errors;
}

export function syncPythonContract(root, config, runCommand = execFileSync) {
  const pythonPolicy = config.dependencyPolicy?.python || {};
  const enabled = pythonPolicyEnabled(config);
  if (!enabled) return [];
  try {
    if (existsSync(join(root, "uv.lock"))) {
      if (!repositoryRegularFile(root, "uv.lock") || !repositoryRegularFile(root, "pyproject.toml")) {
        return ["uv.lock and pyproject.toml must be regular, non-symlink repository files"];
      }
      runCommand("uv", ["sync", "--locked"], { cwd: root, stdio: "inherit" });
    } else {
      const lockFile = String(pythonPolicy.requirementsLockFile || "requirements.lock");
      if (!repositoryRegularFile(root, lockFile)) {
        return ["requirementsLockFile must be a regular, non-symlink repository file outside trusted control paths"];
      }
      runCommand(
        "python",
        [
          "-m",
          "pip",
          "--isolated",
          "install",
          "--index-url",
          OFFICIAL_PYTHON_INDEX,
          "--require-hashes",
          "--only-binary",
          ":all:",
          "-r",
          lockFile
        ],
        { cwd: root, stdio: "inherit" }
      );
    }
    return [];
  } catch (error) {
    return [`locked Python dependency sync failed: ${error.message}`];
  }
}

async function registryMetadata(name, registry, fetchImpl, timeoutMilliseconds) {
  const encodedName = name.startsWith("@") ? name.replace("/", "%2F") : encodeURIComponent(name);
  let response;
  try {
    response = await fetchImpl(new URL(encodedName, registry), {
      // Full packument metadata is required for per-version publication times
      // and lifecycle scripts; abbreviated install metadata does not guarantee them.
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMilliseconds)
    });
  } catch (error) {
    return { error: `registry metadata for '${name}' was not verified: ${error.message}` };
  }
  if (response.status === 404) return { error: `registry package '${name}' does not exist` };
  if (!response.ok) return { error: `registry metadata for '${name}' was not verified: HTTP ${response.status}` };
  try {
    return { metadata: await response.json() };
  } catch (error) {
    return { error: `registry metadata for '${name}' was not verified: invalid JSON (${error.message})` };
  }
}

export async function verifyChangedDependency({
  entry,
  version,
  registry,
  workspacePolicy,
  nodePolicy = {},
  baseTyposquatExceptions = [],
  protectedNames = DEFAULT_PROTECTED_PACKAGE_NAMES,
  fetchImpl = fetch,
  now = Date.now(),
  requireInstallScript = false
}) {
  const errors = [];
  const specifier = classifyDependencySpecifier(entry.specifier);
  if (!specifier.allowed) return [`${entry.name}@${entry.specifier}: ${specifier.reason}`];
  if (!version) return [`${entry.name}@${entry.specifier}: exact locked version was not verified`];

  const suspicious = findSuspiciousName(entry.name, protectedNames);
  if (suspicious) {
    const exception = typosquatException(nodePolicy.typosquatExceptions, entry.name, version);
    const baseException = typosquatException(baseTyposquatExceptions, entry.name, version);
    if (!exception) {
      errors.push(`${suspicious.message}; add a version-scoped dependencyPolicy.node.typosquatExceptions entry with a reason to review it explicitly`);
    } else if (baseException && baseException.reason === exception.reason) {
      errors.push(`${suspicious.message}; its version-scoped exception must be added or materially changed in this diff`);
    }
  }

  const result = await registryMetadata(entry.name, registry, fetchImpl, configuredRegistryTimeout(nodePolicy));
  if (result.error) return [...errors, result.error];
  const metadata = result.metadata;
  const versionMetadata = metadata?.versions?.[version];
  if (!versionMetadata) {
    errors.push(`registry version '${entry.name}@${version}' does not exist`);
    return errors;
  }
  const publishedAt = metadata?.time?.[version];
  const publishedTime = Date.parse(publishedAt || "");
  if (!Number.isFinite(publishedTime)) {
    errors.push(`publication date for '${entry.name}@${version}' was not verified`);
  } else {
    const minimumAge = configuredMinimumReleaseAge(nodePolicy);
    if (now - publishedTime < minimumAge * 60_000) {
      errors.push(`'${entry.name}@${version}' is younger than the ${minimumAge}-minute minimum release age`);
    }
  }

  const scripts = versionMetadata.scripts || {};
  const installScripts = INSTALL_SCRIPT_NAMES.filter((name) => typeof scripts[name] === "string" && scripts[name].trim());
  if (requireInstallScript && installScripts.length === 0) {
    errors.push(`'${entry.name}@${version}' has no install lifecycle script to justify allowBuilds`);
  }
  if (installScripts.length > 0 && workspacePolicy.allowBuilds.get(`${entry.name}@${version}`) !== true) {
    errors.push(`'${entry.name}@${version}' declares ${installScripts.join(", ")} and is not allowed by exact-version allowBuilds`);
  }
  return errors;
}

export async function runDependencyPolicy({
  root,
  baseRef,
  headRef,
  fetchImpl = fetch,
  runCommand = execFileSync,
  now = Date.now()
}) {
  const errors = [];
  if (!repositoryRegularFile(root, ".unicorn-hub/config.json")) {
    return [".unicorn-hub/config.json must be a regular, non-symlink repository file"];
  }
  const config = readConfig(root);
  const nodePolicy = config.dependencyPolicy?.node || {};
  const configuredAge = Number(nodePolicy.minimumReleaseAgeMinutes ?? 10080);
  if (!Number.isSafeInteger(configuredAge) || configuredAge < 10080) {
    errors.push("dependencyPolicy.node.minimumReleaseAgeMinutes must be an integer of at least 10080");
  }
  const configuredTimeout = Number(nodePolicy.registryTimeoutMilliseconds ?? 10000);
  if (!Number.isSafeInteger(configuredTimeout) || configuredTimeout < 1000 || configuredTimeout > 30000) {
    errors.push("dependencyPolicy.node.registryTimeoutMilliseconds must be an integer from 1000 through 30000");
  }
  const minimumAge = configuredMinimumReleaseAge(nodePolicy);
  const workspacePath = repositoryRegularFile(root, "pnpm-workspace.yaml");
  if (!workspacePath) {
    errors.push("pnpm-workspace.yaml must be a regular, non-symlink repository file");
    return errors;
  }
  const workspaceValidation = validateWorkspacePolicy(readFileSync(workspacePath, "utf8"), minimumAge);
  errors.push(...workspaceValidation.errors.map((error) => `pnpm workspace policy: ${error}`));
  const localLockCandidate = repositoryPath(root, "pnpm-lock.yaml");
  const localLockPath = repositoryRegularFile(root, "pnpm-lock.yaml");
  if (!localLockCandidate || !existsSync(localLockCandidate)) {
    errors.push("pnpm-lock.yaml is required; dependency installation was not verified");
  } else if (!localLockPath) {
    errors.push("pnpm-lock.yaml must be a regular, non-symlink repository file");
  } else {
    errors.push(...validateLockfileRegistries(readFileSync(localLockPath, "utf8")));
  }
  const npmrcCandidate = repositoryPath(root, ".npmrc");
  if (npmrcCandidate && existsSync(npmrcCandidate) && !repositoryRegularFile(root, ".npmrc")) {
    errors.push(".npmrc must be a regular, non-symlink repository file");
  }
  const npmrcPath = repositoryRegularFile(root, ".npmrc");
  const npmrc = parseNpmrc(npmrcPath ? readFileSync(npmrcPath, "utf8") : "");
  const allowedRegistry = normalizeUrl(OFFICIAL_NPM_REGISTRY);
  for (const [label, registry] of [["default", npmrc.default], ...npmrc.scopes.entries()]) {
    if (normalizeUrl(registry) !== allowedRegistry) {
      errors.push(`unknown ${label === "default" ? "default" : `${label} scoped`} npm registry`);
    }
  }
  for (const setting of npmrc.unsafeSettings) {
    errors.push(`project .npmrc request-routing setting '${setting}' is not supported`);
  }
  for (const setting of npmrc.unsafePolicySettings) {
    errors.push(`project .npmrc dependency-policy override '${setting}' is not supported`);
  }
  let baseManifestPaths = [];
  let headManifestPaths = [];
  if (!baseRef || !headRef) {
    errors.push("base and head git refs are required to verify changed direct dependencies");
  } else {
    try {
      baseManifestPaths = manifestPathsAtRef(root, baseRef);
      headManifestPaths = manifestPathsAtRef(root, headRef);
      for (const manifestPath of headManifestPaths) {
        if (!repositoryRegularFile(root, manifestPath)) {
          errors.push(`package manifest '${manifestPath}' must be a regular, non-symlink repository file`);
        }
      }
    } catch {
      errors.push("base and head git refs were not resolved for dependency verification");
    }
  }
  if (errors.length > 0) return errors;

  errors.push(...runFrozenLockCheck(root, runCommand));
  if (errors.length > 0) return errors;
  errors.push(...validatePythonContract(root, config, runCommand));
  if (errors.length > 0) return errors;

  const baseConfig = jsonAtRef(root, baseRef, ".unicorn-hub/config.json");
  if (pythonPolicyEnabled(baseConfig) && !pythonPolicyEnabled(config)) {
    errors.push("Python dependency policy cannot be disabled for a repository that already requires it");
  }
  const headLockText = textAtRef(root, headRef, "pnpm-lock.yaml") ?? readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const baseLockText = textAtRef(root, baseRef, "pnpm-lock.yaml") || "";
  errors.push(...validateLockfileRegistries(headLockText));
  const lockResolutions = parsePnpmLockImporters(headLockText);
  const baseLockResolutions = parsePnpmLockImporters(baseLockText);
  const baseWorkspaceText = textAtRef(root, baseRef, "pnpm-workspace.yaml") || "";
  const baseWorkspacePolicy = parseWorkspacePolicy(baseWorkspaceText);
  const manifests = [...new Set([
    ...baseManifestPaths,
    ...headManifestPaths
  ])].sort();
  const manifestPairs = manifests.map((manifestPath) => ({
    manifestPath,
    baseManifest: jsonAtRef(root, baseRef, manifestPath),
    headManifest: jsonAtRef(root, headRef, manifestPath)
  }));
  const protectedNames = new Set([
    ...DEFAULT_PROTECTED_PACKAGE_NAMES,
    ...(Array.isArray(baseConfig.dependencyPolicy?.node?.protectedPackageNames)
      ? baseConfig.dependencyPolicy.node.protectedPackageNames
      : []),
    ...(Array.isArray(nodePolicy.protectedPackageNames) ? nodePolicy.protectedPackageNames : [])
  ]);
  for (const { baseManifest } of manifestPairs) {
    for (const dependency of collectDirectDependencies(baseManifest).values()) protectedNames.add(dependency.name);
  }

  for (const { manifestPath, baseManifest, headManifest } of manifestPairs) {
    const manifestChanges = new Set(changedDirectDependencies(baseManifest, headManifest)
      .map((entry) => `${entry.field}\0${entry.name}`));
    const baseDependencies = collectDirectDependencies(baseManifest);
    const dependencyChanges = [...collectDirectDependencies(headManifest).values()].filter((entry) => {
      const key = `${entry.field}\0${entry.name}`;
      if (manifestChanges.has(key)) return true;
      const previous = baseDependencies.get(key);
      if (!previous) return true;
      return lockedResolution(previous, manifestPath, baseLockResolutions) !==
        lockedResolution(entry, manifestPath, lockResolutions);
    });
    for (const entry of dependencyChanges) {
      const selectedRegistry = registryForPackage(entry.name, npmrc);
      if (selectedRegistry !== allowedRegistry) {
        errors.push(`${manifestPath}: unknown registry for '${entry.name}'`);
        continue;
      }
      const version = resolveExactVersion(entry, manifestPath, lockResolutions);
      const dependencyErrors = await verifyChangedDependency({
        entry,
        version,
        registry: selectedRegistry,
        workspacePolicy: workspaceValidation.policy,
        nodePolicy,
        baseTyposquatExceptions: baseConfig.dependencyPolicy?.node?.typosquatExceptions || [],
        protectedNames,
        fetchImpl,
        now
      });
      errors.push(...dependencyErrors.map((error) => `${manifestPath}: ${error}`));
    }
  }

  for (const [matcher, allowed] of workspaceValidation.policy.allowBuilds) {
    if (!allowed || baseWorkspacePolicy.allowBuilds.get(matcher) === true) continue;
    const parsed = splitVersionScopedMatcher(matcher);
    if (!parsed) continue;
    const selectedRegistry = registryForPackage(parsed.name, npmrc);
    if (selectedRegistry !== allowedRegistry) continue;
    const buildErrors = await verifyChangedDependency({
      entry: { name: parsed.name, specifier: parsed.version, field: "dependencies" },
      version: parsed.version,
      registry: selectedRegistry,
      workspacePolicy: workspaceValidation.policy,
      nodePolicy,
      baseTyposquatExceptions: baseConfig.dependencyPolicy?.node?.typosquatExceptions || [],
      protectedNames,
      fetchImpl,
      now,
      requireInstallScript: true
    });
    errors.push(...buildErrors.map((error) => `pnpm-workspace.yaml: ${error}`));
  }
  return errors;
}

async function main() {
  const args = parseArgs();
  const root = resolve(args.target || findRepoRoot());
  const [positionalBase, positionalHead] = args._ || [];
  const baseRef = String(args.base || positionalBase || "");
  const headRef = String(args.head || positionalHead || "");
  const errors = await runDependencyPolicy({ root, baseRef, headRef });
  if (errors.length === 0 && args["sync-python"]) {
    errors.push(...syncPythonContract(root, readConfig(root)));
  }
  if (errors.length > 0) {
    console.error("Dependency policy check failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("Dependency policy check passed.");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
