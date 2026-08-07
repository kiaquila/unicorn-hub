import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(".");

function writeExecutable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function publish(args = []) {
  const target = mkdtempSync(join(tmpdir(), "unicorn-publish-"));
  const bin = join(target, "bin");
  const log = join(target, "gh-create-args.json");
  mkdirSync(bin);
  mkdirSync(join(target, ".unicorn-hub"));
  writeFileSync(join(target, ".unicorn-hub/config.json"), '{"defaultBaseBranch":"main"}\n');
  writeFileSync(join(target, "package.json"), '{"private":true}\n');

  writeExecutable(join(bin, "git"), `#!/bin/sh
if [ "$1" = "branch" ]; then
  printf '%s\\n' 'test-ready-pr'
fi
`);
  writeExecutable(join(bin, "pnpm"), "#!/bin/sh\nexit 0\n");
  writeExecutable(join(bin, "gh"), `#!/bin/sh
if [ "$1" = "repo" ]; then
  printf '%s\\n' 'synthetic-owner/synthetic-repo'
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  exit 1
fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  node -e 'require("node:fs").writeFileSync(process.env.GH_CREATE_LOG, JSON.stringify(process.argv.slice(1)))' "$@"
fi
`);

  execFileSync("node", [join(root, "scripts/publish-branch.mjs"), ...args], {
    cwd: target,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_CREATE_LOG: log },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(readFileSync(log, "utf8"));
}

test("publish-branch creates a ready-for-review PR by default", () => {
  const args = publish();
  assert.equal(args.includes("--draft"), false);
  assert.deepEqual(args.slice(0, 2), ["pr", "create"]);
});

test("publish-branch creates a draft PR only with --draft", () => {
  const args = publish(["--draft"]);
  assert.equal(args.includes("--draft"), true);
});
