import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changedDirectDependencies,
  classifyDependencySpecifier,
  findSuspiciousName,
  parseNpmrc,
  parsePnpmLockImporters,
  parseWorkspacePolicy,
  runDependencyPolicy,
  syncPythonContract,
  validateHashedRequirements,
  validateLockfileRegistries,
  validatePackageManifestPolicy,
  validatePythonContract,
  validateWorkspacePolicy,
  verifyChangedDependency
} from "../scripts/check-dependency-policy.mjs";

const NOW = Date.parse("2026-01-20T00:00:00Z");
const OLD_PUBLICATION = "2025-01-01T00:00:00Z";

function response(status, body = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    }
  };
}

function metadata(name, version, options = {}) {
  return {
    name,
    versions: {
      [version]: {
        name,
        version,
        ...(options.scripts ? { scripts: options.scripts } : {})
      }
    },
    time: { [version]: options.publishedAt || OLD_PUBLICATION }
  };
}

function workspace(allowBuilds = []) {
  const entries = allowBuilds.map((matcher) => `  "${matcher}": true`).join("\n");
  return [
    "minimumReleaseAge: 10080",
    "blockExoticSubdeps: true",
    "trustPolicy: no-downgrade",
    "strictDepBuilds: true",
    entries ? `allowBuilds:\n${entries}` : "allowBuilds: {}",
    "packages:",
    "  - .",
    ""
  ].join("\n");
}

function lockfile(dependencies = {}) {
  const names = Object.keys(dependencies);
  const dependencyBlock = names.length === 0
    ? "  .: {}"
    : [
        "  .:",
        "    dependencies:",
        ...names.flatMap((name) => [
          `      ${name}:`,
          `        specifier: ${dependencies[name].specifier}`,
          `        version: ${dependencies[name].version}`
        ])
      ].join("\n");
  return [
    "lockfileVersion: '9.0'",
    "",
    "settings:",
    "  autoInstallPeers: true",
    "  excludeLinksFromLockfile: false",
    "",
    "importers:",
    "",
    dependencyBlock,
    ""
  ].join("\n");
}

function policyConfig(overrides = {}) {
  return {
    docsDir: "docs",
    specsDir: "specs",
    profile: "generic",
    dependencyPolicy: {
      node: {
        minimumReleaseAgeMinutes: 10080,
        registryTimeoutMilliseconds: 1000,
        protectedPackageNames: [],
        typosquatExceptions: []
      },
      python: { enabled: false, requirementsLockFile: "requirements.lock" }
    },
    ...overrides
  };
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function syntheticRepo({
  baseDependencies = {},
  baseLockedVersions = {},
  headDependencies = {},
  npmrc = "",
  includeLock = true,
  headLockedVersions = {},
  config = policyConfig(),
  headConfig = config,
  baseWorkspace = workspace(),
  headWorkspace = baseWorkspace
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "unicorn-dependency-policy-"));
  mkdirSync(join(root, ".unicorn-hub"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, ".unicorn-hub/config.json"), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(root, "pnpm-workspace.yaml"), baseWorkspace);
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "synthetic", dependencies: baseDependencies }, null, 2)}\n`);
  writeFileSync(join(root, "pnpm-lock.yaml"), lockfile(Object.fromEntries(
    Object.entries(baseDependencies).map(([name, specifier]) => [
      name,
      { specifier, version: baseLockedVersions[name] || specifier }
    ])
  )));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "synthetic@example.invalid"]);
  git(root, ["config", "user.name", "Synthetic Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);

  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "synthetic", dependencies: headDependencies }, null, 2)}\n`);
  writeFileSync(join(root, ".unicorn-hub/config.json"), `${JSON.stringify(headConfig, null, 2)}\n`);
  writeFileSync(join(root, "pnpm-workspace.yaml"), headWorkspace);
  writeFileSync(join(root, "head-marker.txt"), "synthetic head\n");
  if (includeLock) {
    writeFileSync(join(root, "pnpm-lock.yaml"), lockfile(Object.fromEntries(
      Object.entries(headDependencies).map(([name, specifier]) => [
        name,
        { specifier, version: headLockedVersions[name] || specifier }
      ])
    )));
  } else {
    unlinkSync(join(root, "pnpm-lock.yaml"));
  }
  if (npmrc) writeFileSync(join(root, ".npmrc"), npmrc);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "head"]);
  return root;
}

function noOpCommand() {
  return "";
}

test("valid official-registry package and exact version pass", async () => {
  let acceptHeader = "";
  const errors = await verifyChangedDependency({
    entry: { name: "lodash", specifier: "^4.17.21", field: "dependencies" },
    version: "4.17.21",
    registry: "https://registry.npmjs.org/",
    workspacePolicy: parseWorkspacePolicy(workspace()),
    fetchImpl: async (_url, options) => {
      acceptHeader = options.headers.accept;
      return response(200, metadata("lodash", "4.17.21"));
    },
    now: NOW
  });
  assert.deepEqual(errors, []);
  assert.equal(acceptHeader, "application/json", "full packument metadata is required for time and scripts");
});

test("nonexistent registry name or exact version is blocked", async () => {
  const common = {
    entry: { name: "synthetic-package", specifier: "1.0.0", field: "dependencies" },
    version: "1.0.0",
    registry: "https://registry.npmjs.org/",
    workspacePolicy: parseWorkspacePolicy(workspace()),
    now: NOW
  };
  assert.match((await verifyChangedDependency({ ...common, fetchImpl: async () => response(404) })).join("\n"), /does not exist/);
  assert.match(
    (await verifyChangedDependency({ ...common, fetchImpl: async () => response(200, metadata("synthetic-package", "2.0.0")) })).join("\n"),
    /version .* does not exist/
  );
});

test("one-edit typo and adjacent transposition are blocked", () => {
  assert.match(findSuspiciousName("lodasx").message, /protected name 'lodash'/);
  assert.match(findSuspiciousName("lodahs").message, /adjacent transposition/);
  assert.match(findSuspiciousName("@angualr/core", ["@angular/core"]).message, /protected name '@angular\/core'/);
});

test("direct dependency changes remain distinct across manifest fields", () => {
  const changes = changedDirectDependencies(
    { dependencies: { lodash: "4.17.21" }, devDependencies: { lodash: "4.17.21" } },
    { dependencies: { lodash: "git+https://example.invalid/lodash.git" }, devDependencies: { lodash: "4.17.21" } }
  );
  assert.deepEqual(changes, [{
    name: "lodash",
    specifier: "git+https://example.invalid/lodash.git",
    field: "dependencies"
  }]);
});

test("Unicode confusable substitution is blocked", () => {
  const cyrillicA = "lod\u0430sh";
  assert.equal(findSuspiciousName(cyrillicA).kind, "unicode");
});

test("Git, URL, tarball, archive, and local dependencies are blocked", () => {
  for (const specifier of [
    "git+https://example.invalid/repo.git",
    "https://example.invalid/pkg.tgz",
    "file:../pkg",
    "../pkg",
    "package.zip"
  ]) {
    assert.equal(classifyDependencySpecifier(specifier).allowed, false, specifier);
  }
});

test("unknown npm registry is blocked before metadata lookup", async () => {
  const root = syntheticRepo({
    headDependencies: { lodash: "4.17.21" },
    npmrc: "registry=https://packages.example.invalid/\n"
  });
  let fetchCalls = 0;
  const errors = await runDependencyPolicy({
    root,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: noOpCommand,
    fetchImpl: async () => {
      fetchCalls += 1;
      return response(200, metadata("lodash", "4.17.21"));
    },
    now: NOW
  });
  assert.match(errors.join("\n"), /unknown .*registry/);
  assert.equal(fetchCalls, 0);
  assert.equal(parseNpmrc("registry=https://packages.example.invalid/").default, "https://packages.example.invalid/");
});

test("registry unavailability is reported as not verified and fails closed", async () => {
  const errors = await verifyChangedDependency({
    entry: { name: "lodash", specifier: "4.17.21", field: "dependencies" },
    version: "4.17.21",
    registry: "https://registry.npmjs.org/",
    workspacePolicy: parseWorkspacePolicy(workspace()),
    fetchImpl: async () => {
      throw new Error("synthetic registry outage");
    },
    now: NOW
  });
  assert.match(errors.join("\n"), /not verified.*synthetic registry outage/);
});

test("newly published registry version is blocked by release age", async () => {
  const errors = await verifyChangedDependency({
    entry: { name: "synthetic-package", specifier: "1.0.0", field: "dependencies" },
    version: "1.0.0",
    registry: "https://registry.npmjs.org/",
    workspacePolicy: parseWorkspacePolicy(workspace()),
    fetchImpl: async () => response(200, metadata("synthetic-package", "1.0.0", {
      publishedAt: "2026-01-19T23:00:00Z"
    })),
    now: NOW
  });
  assert.match(errors.join("\n"), /younger than the 10080-minute minimum release age/);
});

test("unknown install script is blocked and exact-version allowBuilds passes", async () => {
  const common = {
    entry: { name: "synthetic-builder", specifier: "1.2.3", field: "dependencies" },
    version: "1.2.3",
    registry: "https://registry.npmjs.org/",
    fetchImpl: async () => response(200, metadata("synthetic-builder", "1.2.3", { scripts: { install: "node build.js" } })),
    now: NOW
  };
  const blocked = await verifyChangedDependency({ ...common, workspacePolicy: parseWorkspacePolicy(workspace()) });
  assert.match(blocked.join("\n"), /not allowed by exact-version allowBuilds/);

  const allowed = await verifyChangedDependency({
    ...common,
    workspacePolicy: parseWorkspacePolicy(workspace(["synthetic-builder@1.2.3"]))
  });
  assert.deepEqual(allowed, []);
});

test("version-scoped typo exception requires a reason and permits reviewed name", async () => {
  const common = {
    entry: { name: "lodahs", specifier: "1.0.0", field: "dependencies" },
    version: "1.0.0",
    registry: "https://registry.npmjs.org/",
    workspacePolicy: parseWorkspacePolicy(workspace()),
    fetchImpl: async () => response(200, metadata("lodahs", "1.0.0")),
    now: NOW
  };
  const missingReason = await verifyChangedDependency({
    ...common,
    nodePolicy: { typosquatExceptions: [{ package: "lodahs", version: "1.0.0", reason: "" }] }
  });
  assert.match(missingReason.join("\n"), /version-scoped/);
  const reviewed = await verifyChangedDependency({
    ...common,
    nodePolicy: { typosquatExceptions: [{ package: "lodahs", version: "1.0.0", reason: "Reviewed synthetic fixture" }] }
  });
  assert.deepEqual(reviewed, []);
  const planted = await verifyChangedDependency({
    ...common,
    nodePolicy: { typosquatExceptions: [{ package: "lodahs", version: "1.0.0", reason: "Reviewed synthetic fixture" }] },
    baseTyposquatExceptions: [{ package: "lodahs", version: "1.0.0", reason: "Reviewed synthetic fixture" }]
  });
  assert.match(planted.join("\n"), /added or materially changed in this diff/);
});

test("removing a protected name cannot authorize its typo in the same diff", async () => {
  const baseConfig = policyConfig({
    dependencyPolicy: {
      node: {
        minimumReleaseAgeMinutes: 10080,
        registryTimeoutMilliseconds: 1000,
        protectedPackageNames: ["synthetic-package"],
        typosquatExceptions: []
      },
      python: { enabled: false, requirementsLockFile: "requirements.lock" }
    }
  });
  const headConfig = policyConfig();
  const root = syntheticRepo({
    config: baseConfig,
    headConfig,
    headDependencies: { "synthetic-packag": "1.0.0" }
  });
  const errors = await runDependencyPolicy({
    root,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: noOpCommand,
    fetchImpl: async () => response(200, metadata("synthetic-packag", "1.0.0")),
    now: NOW
  });
  assert.match(errors.join("\n"), /protected name 'synthetic-package'/);
});

test("workspace policy rejects missing hardening and unscoped build permissions", () => {
  assert.deepEqual(validateWorkspacePolicy(workspace()).errors, []);
  assert.deepEqual(validateWorkspacePolicy(`# portable policy\n${workspace()}`).errors, []);
  const errors = validateWorkspacePolicy([
    "minimumReleaseAge: 1",
    "blockExoticSubdeps: false",
    "trustPolicy: off",
    "strictDepBuilds: false",
    "dangerouslyAllowAllBuilds: true",
    "allowBuilds:",
    "  synthetic-builder: true"
  ].join("\n")).errors;
  assert.match(errors.join("\n"), /minimumReleaseAge/);
  assert.match(errors.join("\n"), /dangerouslyAllowAllBuilds/);
  assert.match(errors.join("\n"), /exact version/);
});

test("workspace policy rejects alternate registries, escape hatches, and YAML scalar indirection", () => {
  const registryErrors = validateWorkspacePolicy(`${workspace()}registry: https://packages.example.invalid/\n`).errors;
  assert.match(registryErrors.join("\n"), /official npm registry/);
  const bypassErrors = validateWorkspacePolicy([
    workspace(),
    "minimumReleaseAgeExclude:",
    "  - synthetic-package",
    "trustPolicyExclude: synthetic-package",
    "httpsProxy: http://packages.example.invalid/",
    "ignoredBuiltDependencies:",
    "  - synthetic-builder"
  ].join("\n")).errors;
  assert.match(bypassErrors.join("\n"), /minimumReleaseAgeExclude/);
  assert.match(bypassErrors.join("\n"), /trustPolicyExclude/);
  assert.match(bypassErrors.join("\n"), /httpsProxy/);
  assert.match(bypassErrors.join("\n"), /ignoredBuiltDependencies/);
  const typedBoolean = validateWorkspacePolicy(workspace().replace(
    "allowBuilds: {}",
    "allowBuilds:\n  synthetic-builder@1.2.3: !!bool true"
  )).errors;
  assert.match(typedBoolean.join("\n"), /type tags|canonical true\/false/);
  assert.match(
    validateWorkspacePolicy(`${workspace()}"dangerouslyAllowAllBuilds": true\n`).errors.join("\n"),
    /canonical unquoted/
  );
  assert.match(
    validateWorkspacePolicy(`${workspace()}"registry": https:\/\/packages.example.invalid\/\n`).errors.join("\n"),
    /canonical unquoted/
  );
  for (const setting of ["overrides", "packageExtensions", "patchedDependencies", "onlyBuiltDependencies"]) {
    assert.match(
      validateWorkspacePolicy(`${workspace()}${setting}: {}\n`).errors.join("\n"),
      new RegExp(`${setting} is not supported`)
    );
  }
});

test("package manifest pnpm policy and graph rewrites are rejected before pnpm runs", async () => {
  assert.deepEqual(validatePackageManifestPolicy({ name: "synthetic", pnpm: {} }), []);
  for (const setting of ["overrides", "packageExtensions", "patchedDependencies", "onlyBuiltDependencies"]) {
    const root = syntheticRepo();
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.pnpm = { [setting]: { "synthetic-package": "1.2.3" } };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-qm", "add graph rewrite"]);
    let commandCalls = 0;
    const errors = await runDependencyPolicy({
      root,
      baseRef: "HEAD~1",
      headRef: "HEAD",
      runCommand: () => {
        commandCalls += 1;
        return "";
      },
      fetchImpl: async () => response(200, {}),
      now: NOW
    });
    assert.match(errors.join("\n"), new RegExp(`pnpm\\.${setting} is not supported`));
    assert.equal(commandCalls, 0, setting);
  }
});

test("new allowBuilds permission must match a verified install script", async () => {
  const root = syntheticRepo({
    baseWorkspace: workspace(),
    headWorkspace: workspace(["synthetic-builder@1.2.3"])
  });
  const errors = await runDependencyPolicy({
    root,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: noOpCommand,
    fetchImpl: async () => response(200, metadata("synthetic-builder", "1.2.3")),
    now: NOW
  });
  assert.match(errors.join("\n"), /no install lifecycle script to justify allowBuilds/);
});

test("project npmrc request routing is rejected before pnpm runs", async () => {
  const root = syntheticRepo({ npmrc: "https-proxy=http://packages.example.invalid/\n" });
  let commandCalls = 0;
  const errors = await runDependencyPolicy({
    root,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: () => {
      commandCalls += 1;
      return "";
    },
    fetchImpl: async () => response(200, {}),
    now: NOW
  });
  assert.match(errors.join("\n"), /request-routing setting 'https-proxy'/);
  assert.equal(commandCalls, 0);
});

test("project npmrc cannot override dependency build policy", async () => {
  const root = syntheticRepo({ npmrc: "dangerously-allow-all-builds=true\n" });
  let commandCalls = 0;
  const errors = await runDependencyPolicy({
    root,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: () => {
      commandCalls += 1;
      return "";
    },
    fetchImpl: async () => response(200, {}),
    now: NOW
  });
  assert.match(errors.join("\n"), /dependency-policy override 'dangerously-allow-all-builds'/);
  assert.equal(commandCalls, 0);
});

test("repository pnpm hook files and settings are rejected before pnpm runs", async () => {
  for (const hookFile of [".pnpmfile.cjs", ".pnpmfile.mjs"]) {
    const root = syntheticRepo();
    writeFileSync(join(root, hookFile), "module.exports = { hooks: {} };\n");
    git(root, ["add", hookFile]);
    git(root, ["commit", "-qm", "add pnpm hook"]);
    let commandCalls = 0;
    const errors = await runDependencyPolicy({
      root,
      baseRef: "HEAD~1",
      headRef: "HEAD",
      runCommand: () => {
        commandCalls += 1;
        return "";
      },
      fetchImpl: async () => response(200, {}),
      now: NOW
    });
    assert.match(errors.join("\n"), new RegExp(`${hookFile.replaceAll(".", "\\.")}.*not supported`));
    assert.equal(commandCalls, 0, hookFile);
  }

  for (const setting of ["pnpmfile=.pnpm/custom.cjs", "global-pnpmfile=.pnpm/global.cjs"]) {
    const root = syntheticRepo({ npmrc: `${setting}\n` });
    let commandCalls = 0;
    const errors = await runDependencyPolicy({
      root,
      baseRef: "HEAD~1",
      headRef: "HEAD",
      runCommand: () => {
        commandCalls += 1;
        return "";
      },
      fetchImpl: async () => response(200, {}),
      now: NOW
    });
    assert.match(errors.join("\n"), /pnpm hook setting/);
    assert.equal(commandCalls, 0, setting);
  }

  const workspaceErrors = validateWorkspacePolicy(`${workspace()}pnpmfile: .pnpm/custom.cjs\n`).errors;
  assert.match(workspaceErrors.join("\n"), /pnpmfile is not supported/);
});

test("invalid numeric policy configuration fails instead of weakening checks", async () => {
  const root = syntheticRepo({
    config: policyConfig({
      dependencyPolicy: {
        node: {
          minimumReleaseAgeMinutes: "not-a-number",
          registryTimeoutMilliseconds: 999999,
          protectedPackageNames: [],
          typosquatExceptions: []
        },
        python: { enabled: false, requirementsLockFile: "requirements.lock" }
      }
    })
  });
  const errors = await runDependencyPolicy({
    root,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: noOpCommand,
    fetchImpl: async () => response(200, {}),
    now: NOW
  });
  assert.match(errors.join("\n"), /minimumReleaseAgeMinutes must be an integer/);
  assert.match(errors.join("\n"), /registryTimeoutMilliseconds must be an integer/);
});

test("missing or stale pnpm lockfile is blocked", async () => {
  const missingRoot = syntheticRepo({ headDependencies: { lodash: "4.17.21" }, includeLock: false });
  const missing = await runDependencyPolicy({
    root: missingRoot,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: noOpCommand,
    fetchImpl: async () => response(200, metadata("lodash", "4.17.21")),
    now: NOW
  });
  assert.match(missing.join("\n"), /pnpm-lock.yaml is required/);

  const staleRoot = syntheticRepo({ headDependencies: { lodash: "4.17.21" } });
  const stale = await runDependencyPolicy({
    root: staleRoot,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: () => {
      const error = new Error("frozen lock mismatch");
      error.stderr = "ERR_PNPM_OUTDATED_LOCKFILE";
      throw error;
    },
    fetchImpl: async () => response(200, metadata("lodash", "4.17.21")),
    now: NOW
  });
  assert.match(stale.join("\n"), /stale.*frozen verification failed/);
});

test("frozen pnpm verification disables scripts and pnpmfile hooks", async () => {
  const root = syntheticRepo();
  let argumentsSeen = [];
  const errors = await runDependencyPolicy({
    root,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: (_command, args) => {
      argumentsSeen = args;
      return "";
    },
    fetchImpl: async () => response(200, {}),
    now: NOW
  });
  assert.deepEqual(errors, []);
  assert.ok(argumentsSeen.includes("--ignore-scripts"));
  assert.ok(argumentsSeen.includes("--ignore-pnpmfile"));
});

test("security-critical Node policy files must not be symlinks", async () => {
  const cases = [
    ["package.json", `${JSON.stringify({ name: "synthetic" }, null, 2)}\n`],
    ["pnpm-workspace.yaml", workspace()],
    ["pnpm-lock.yaml", lockfile()],
    [".npmrc", "registry=https://registry.npmjs.org/\n"],
    [".unicorn-hub/config.json", `${JSON.stringify(policyConfig(), null, 2)}\n`]
  ];
  for (const [path, content] of cases) {
    const root = syntheticRepo();
    mkdirSync(join(root, ".gate-trusted"), { recursive: true });
    const targetName = path === ".unicorn-hub/config.json" ? "config.json" : path;
    writeFileSync(join(root, ".gate-trusted", targetName), content);
    if (existsSync(join(root, path))) unlinkSync(join(root, path));
    const relativeTarget = path.startsWith(".unicorn-hub/")
      ? `../.gate-trusted/${targetName}`
      : `.gate-trusted/${targetName}`;
    symlinkSync(relativeTarget, join(root, path));
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "symlink control file"]);
    let commandCalls = 0;
    const errors = await runDependencyPolicy({
      root,
      baseRef: "HEAD~1",
      headRef: "HEAD",
      runCommand: () => {
        commandCalls += 1;
        return "";
      },
      fetchImpl: async () => response(200, {}),
      now: NOW
    });
    assert.match(errors.join("\n"), new RegExp(`${path.replaceAll(".", "\\.")}.*regular, non-symlink`), path);
    assert.equal(commandCalls, 0, path);
  }

  const root = syntheticRepo();
  mkdirSync(join(root, ".gate-trusted"), { recursive: true });
  renameSync(join(root, ".unicorn-hub"), join(root, ".gate-trusted", "config-dir"));
  symlinkSync(".gate-trusted/config-dir", join(root, ".unicorn-hub"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "symlink control directory"]);
  const errors = await runDependencyPolicy({
    root,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: noOpCommand,
    fetchImpl: async () => response(200, {}),
    now: NOW
  });
  assert.match(errors.join("\n"), /config\.json must be a regular, non-symlink/);
});

test("only new or changed direct dependencies trigger registry verification", async () => {
  const root = syntheticRepo({
    baseDependencies: { lodash: "4.17.21" },
    headDependencies: { lodash: "4.17.21" }
  });
  let fetchCalls = 0;
  const errors = await runDependencyPolicy({
    root,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: noOpCommand,
    fetchImpl: async () => {
      fetchCalls += 1;
      return response(200, metadata("lodash", "4.17.21"));
    },
    now: NOW
  });
  assert.deepEqual(errors, []);
  assert.equal(fetchCalls, 0);
});

test("lock-only direct version update triggers exact registry verification", async () => {
  const root = syntheticRepo({
    baseDependencies: { lodash: "^4.17.0" },
    baseLockedVersions: { lodash: "4.17.20" },
    headDependencies: { lodash: "^4.17.0" },
    headLockedVersions: { lodash: "4.17.21" }
  });
  let verifiedVersion = "";
  const errors = await runDependencyPolicy({
    root,
    baseRef: "HEAD~1",
    headRef: "HEAD",
    runCommand: noOpCommand,
    fetchImpl: async () => {
      verifiedVersion = "4.17.21";
      return response(200, metadata("lodash", "4.17.21"));
    },
    now: NOW
  });
  assert.deepEqual(errors, []);
  assert.equal(verifiedVersion, "4.17.21");
});

test("pnpm lock parser resolves direct dependency versions", () => {
  const parsed = parsePnpmLockImporters(lockfile({ lodash: { specifier: "^4.17.0", version: "4.17.21" } }));
  assert.equal(parsed.get(".\0dependencies\0lodash"), "4.17.21");
});

test("pnpm lockfile rejects non-official and exotic package sources", () => {
  assert.deepEqual(validateLockfileRegistries("resolution: {tarball: https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz}\n"), []);
  assert.match(
    validateLockfileRegistries("resolution: {tarball: https://packages.example.invalid/pkg.tgz}\n").join("\n"),
    /non-official package source/
  );
  assert.match(validateLockfileRegistries("resolution: {tarball: file:../pkg.tgz}\n").join("\n"), /Git, local/);
  assert.match(validateLockfileRegistries("resolution: {repo: ssh://git@example.invalid/pkg}\n").join("\n"), /Git, local/);
});

test("Python requirement without exact pin or sha256 hash is blocked", () => {
  const digest = "a".repeat(64);
  assert.deepEqual(validateHashedRequirements(`synthetic-package==1.2.3 --hash=sha256:${digest}\n`), []);
  assert.match(validateHashedRequirements("synthetic-package==1.2.3\n").join("\n"), /missing a sha256 hash/);
  assert.match(validateHashedRequirements(`synthetic-package>=1.2 --hash=sha256:${digest}\n`).join("\n"), /exact == pin/);
  assert.match(validateHashedRequirements(`synthetic-package==1.* --hash=sha256:${digest}\n`).join("\n"), /exact == pin/);
  assert.match(
    validateHashedRequirements(`--index-url https://packages.example.invalid/simple\nsynthetic-package==1.2.3 --hash=sha256:${digest}\n`).join("\n"),
    /unknown Python index/
  );
});

test("Python lock policy applies only to enabled or Python profiles", () => {
  const root = mkdtempSync(join(tmpdir(), "unicorn-python-policy-"));
  assert.deepEqual(validatePythonContract(root, policyConfig(), noOpCommand), []);
  const enabled = policyConfig({
    profile: "python-service",
    dependencyPolicy: { node: {}, python: { enabled: true, requirementsLockFile: "requirements.lock" } }
  });
  assert.match(validatePythonContract(root, enabled, noOpCommand).join("\n"), /requires uv.lock or hashed requirements.lock/);
});

test("Python uv contract checks and syncs locked dependencies without building PR sources", () => {
  const root = mkdtempSync(join(tmpdir(), "unicorn-python-uv-"));
  writeFileSync(join(root, "pyproject.toml"), "[project]\nname = \"synthetic-python\"\nversion = \"0.1.0\"\n");
  writeFileSync(join(root, "uv.lock"), "version = 1\n");
  const config = policyConfig({
    profile: "python-service",
    dependencyPolicy: { node: {}, python: { enabled: true, requirementsLockFile: "requirements.lock" } }
  });
  const calls = [];
  const capture = (command, args) => calls.push([command, ...args]);
  assert.deepEqual(validatePythonContract(root, config, capture), []);
  assert.deepEqual(syncPythonContract(root, config, capture), []);
  assert.deepEqual(calls, [
    ["uv", "lock", "--check", "--no-build"],
    ["uv", "sync", "--locked", "--no-install-project", "--no-build"]
  ]);
});

test("Python uv contract rejects direct Git, URL, and local sources", () => {
  const config = policyConfig({
    profile: "python-service",
    dependencyPolicy: { node: {}, python: { enabled: true, requirementsLockFile: "requirements.lock" } }
  });
  const pyprojectRoot = mkdtempSync(join(tmpdir(), "unicorn-python-uv-direct-"));
  writeFileSync(join(pyprojectRoot, "pyproject.toml"), [
    "[project]",
    "name = \"synthetic-python\"",
    "version = \"0.1.0\"",
    "dependencies = [\"synthetic-package @ git+https://example.invalid/package.git\"]",
    ""
  ].join("\n"));
  writeFileSync(join(pyprojectRoot, "uv.lock"), "version = 1\nsource = { editable = \".\" }\n");
  assert.match(validatePythonContract(pyprojectRoot, config, noOpCommand).join("\n"), /forbidden direct Git/);

  const lockRoot = mkdtempSync(join(tmpdir(), "unicorn-python-uv-lock-source-"));
  writeFileSync(join(lockRoot, "pyproject.toml"), "[project]\nname = \"synthetic-python\"\nversion = \"0.1.0\"\n");
  writeFileSync(join(lockRoot, "uv.lock"), "version = 1\nsource = { git = \"https://example.invalid/package.git\" }\n");
  assert.match(validatePythonContract(lockRoot, config, noOpCommand).join("\n"), /uv\.lock contains a forbidden/);
});

test("Python uv contract accepts only official PyPI artifact URLs", () => {
  const config = policyConfig({
    profile: "python-service",
    dependencyPolicy: { node: {}, python: { enabled: true, requirementsLockFile: "requirements.lock" } }
  });
  const root = mkdtempSync(join(tmpdir(), "unicorn-python-uv-artifact-"));
  writeFileSync(join(root, "pyproject.toml"), "[project]\nname = \"synthetic-python\"\nversion = \"0.1.0\"\n");
  const lockWithUrl = (url) => [
    "version = 1",
    "[[package]]",
    "name = \"synthetic-package\"",
    "version = \"1.2.3\"",
    "source = { registry = \"https://pypi.org/simple\" }",
    `wheels = [{ url = "${url}", hash = "sha256:${"a".repeat(64)}", size = 1 }]`,
    ""
  ].join("\n");

  writeFileSync(join(root, "uv.lock"), lockWithUrl("https://packages.example.invalid/synthetic.whl"));
  let commandCalls = 0;
  const rejected = validatePythonContract(root, config, () => {
    commandCalls += 1;
  });
  assert.match(rejected.join("\n"), /non-official Python artifact URL/);
  assert.equal(commandCalls, 0);

  writeFileSync(join(root, "uv.lock"), lockWithUrl(
    "https://files.pythonhosted.org/packages/aa/bb/synthetic_package-1.2.3-py3-none-any.whl"
  ));
  const calls = [];
  assert.deepEqual(validatePythonContract(root, config, (command, args) => calls.push([command, ...args])), []);
  assert.deepEqual(calls, [["uv", "lock", "--check", "--no-build"]]);
});

test("hashed Python contract uses require-hashes and binary-only install", () => {
  const root = mkdtempSync(join(tmpdir(), "unicorn-python-hashes-"));
  writeFileSync(
    join(root, "requirements.lock"),
    `synthetic-package==1.2.3 --hash=sha256:${"b".repeat(64)}\n`
  );
  const config = policyConfig({
    profile: "python-service",
    commands: { install: "python -m pip --isolated install --index-url https://pypi.org/simple --require-hashes --only-binary :all: -r requirements.lock" },
    dependencyPolicy: { node: {}, python: { enabled: true, requirementsLockFile: "requirements.lock" } }
  });
  const calls = [];
  const capture = (command, args) => calls.push([command, ...args]);
  assert.deepEqual(validatePythonContract(root, config, capture), []);
  assert.deepEqual(syncPythonContract(root, config, capture), []);
  assert.deepEqual(calls, [[
    "python", "-m", "pip", "--isolated", "install", "--index-url", "https://pypi.org/simple",
    "--require-hashes", "--only-binary", ":all:", "-r", "requirements.lock"
  ]]);
});

test("hashed Python lock path cannot escape the repository", () => {
  const root = mkdtempSync(join(tmpdir(), "unicorn-python-path-"));
  const config = policyConfig({
    profile: "python-service",
    commands: { install: "python -m pip --isolated install --index-url https://pypi.org/simple --require-hashes --only-binary :all: -r ../requirements.lock" },
    dependencyPolicy: { node: {}, python: { enabled: true, requirementsLockFile: "../requirements.lock" } }
  });
  assert.match(validatePythonContract(root, config, noOpCommand).join("\n"), /repository-relative file path/);
  assert.match(syncPythonContract(root, config, noOpCommand).join("\n"), /regular, non-symlink repository file/);
});

test("hashed Python lock must not be a symlink or leak rejected requirement content", () => {
  const root = mkdtempSync(join(tmpdir(), "unicorn-python-symlink-"));
  const external = join(tmpdir(), `synthetic-requirements-${Date.now()}.lock`);
  writeFileSync(external, "private-token-value\n");
  symlinkSync(external, join(root, "requirements.lock"));
  const config = policyConfig({
    profile: "python-service",
    commands: { install: "python -m pip --isolated install --index-url https://pypi.org/simple --require-hashes --only-binary :all: -r requirements.lock" },
    dependencyPolicy: { node: {}, python: { enabled: true, requirementsLockFile: "requirements.lock" } }
  });
  const errors = validatePythonContract(root, config, noOpCommand);
  assert.match(errors.join("\n"), /regular, non-symlink repository file/);
  assert.doesNotMatch(errors.join("\n"), /private-token-value/);
  unlinkSync(external);
});
