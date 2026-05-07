import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { walkFiles } from "../scripts/shared.mjs";

const root = resolve(".");

test("repository sanitizer passes on the blueprint", () => {
  const output = execFileSync("node", ["scripts/sanitize-blueprint.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.match(output, /Sanitizer check passed/);
});

test("sanitizer rejects secret-like content", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-sanitize-"));
  mkdirSync(join(target, "docs"), { recursive: true });
  const fakeToken = `gho_${"abcdefghijklmnopqrstuvwxyz123456"}`;
  writeFileSync(join(target, "docs", "bad.md"), `token = ${fakeToken}\n`);

  assert.throws(() => {
    execFileSync("node", ["scripts/sanitize-blueprint.mjs", "--target", target], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });
});

test("sanitizer rejects common personal path formats", () => {
  const samples = [
    `local path /${"home"}/alice/project`,
    "local path C:\\Users\\alice\\project",
    `local path ~${"/"}project`
  ];

  for (const sample of samples) {
    const target = mkdtempSync(join(tmpdir(), "unicorn-sanitize-path-"));
    mkdirSync(join(target, "docs"), { recursive: true });
    writeFileSync(join(target, "docs", "bad.md"), `${sample}\n`);

    assert.throws(() => {
      execFileSync("node", ["scripts/sanitize-blueprint.mjs", "--target", target], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    });
  }
});

test("installed templates do not leak the canonical hub owner name", () => {
  const templatesRoot = join(root, "templates");
  const offending = [];
  for (const rel of walkFiles(templatesRoot)) {
    const content = readFileSync(join(templatesRoot, rel), "utf8");
    if (/kiaquila/i.test(content) || /kiaquila/i.test(rel)) {
      offending.push(rel);
    }
  }
  assert.deepEqual(
    offending,
    [],
    `templates/ must not embed the canonical hub owner; found in: ${offending.join(", ")}`
  );
});

test("sanitizer ignores local OMX runtime state", () => {
  const target = mkdtempSync(join(tmpdir(), "unicorn-sanitize-omx-"));
  mkdirSync(join(target, ".omx/state"), { recursive: true });
  writeFileSync(join(target, ".omx/state/session.json"), JSON.stringify({
    cwd: `/${"Users"}/synthetic/project`
  }));

  const output = execFileSync("node", ["scripts/sanitize-blueprint.mjs", "--target", target], {
    cwd: root,
    encoding: "utf8"
  });

  assert.match(output, /Sanitizer check passed/);
});
