import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(".");

test("root workflows stay generated from templates", () => {
  const output = execFileSync("node", ["scripts/sync-workflows.mjs", "--check"], {
    cwd: root,
    encoding: "utf8"
  });

  assert.match(output, /Root workflows match templates/);
});

test("root Dependabot configuration stays in sync with its template", () => {
  const rootConfig = readFileSync(join(root, ".github", "dependabot.yml"), "utf8");
  const templateConfig = readFileSync(join(root, "templates", ".github", "dependabot.yml"), "utf8");

  assert.equal(rootConfig, templateConfig);
});

test("CI requires a frozen pnpm lockfile without an unsafe fallback", () => {
  const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile/);
  assert.match(workflow, /version: 10\.34\.5/);
  assert.doesNotMatch(workflow, /--no-frozen-lockfile/);
  assert.doesNotMatch(workflow, /if \[ -f pnpm-lock\.yaml \]/);
  assert.ok(
    workflow.indexOf("pnpm run check:repo") < workflow.indexOf("pnpm install --frozen-lockfile"),
    "the pinned pnpm baseline must pass before dependency installation"
  );
});

test("dependency policy remains inside the existing PR Guard context", () => {
  const workflow = readFileSync(join(root, ".github", "workflows", "pr-guard.yml"), "utf8");
  assert.match(workflow, /jobs:\n  guard:\n    name: guard/);
  assert.match(workflow, /check-dependency-policy\.mjs --sync-python/);
  assert.match(workflow, /pnpm\/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86/);
  assert.match(workflow, /version: 10\.34\.5/);
  assert.match(workflow, /astral-sh\/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d/);
  assert.doesNotMatch(workflow, /^  dependency-policy:/m);
});

test("OSV workflow is blocking and retains all activation triggers", () => {
  const workflow = readFileSync(join(root, ".github", "workflows", "osv-scan.yml"), "utf8");
  assert.match(workflow, /on:\n  pull_request:/);
  assert.match(workflow, /push:\n    branches: \["main"\]/);
  assert.match(workflow, /schedule:\n    - cron: "0 6 \* \* 1"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /name: osv-scan/);
  assert.match(workflow, /--fail-on-vuln=true/);
  assert.match(workflow, /osv-reporter-action@6e4298ebc4db23e847df9b2e2de2939d6f066c67/);
});
