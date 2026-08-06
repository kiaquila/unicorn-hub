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
