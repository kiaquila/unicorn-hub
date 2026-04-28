#!/usr/bin/env node
import { readFileSync, appendFileSync } from "node:fs";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const explicitPrNumber = process.env.AI_REVIEW_PR_NUMBER;

if (!token || !repository) {
  console.error("GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
  process.exit(1);
}

const [owner, repo] = repository.split("/");

function eventPrNumber() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    return event.pull_request?.number || event.issue?.number || null;
  } catch {
    return null;
  }
}

async function request(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28"
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

const prNumber = explicitPrNumber || eventPrNumber();
if (!prNumber) {
  console.error("Could not resolve pull request number.");
  process.exit(1);
}

const pull = await request(`/repos/${owner}/${repo}/pulls/${prNumber}`);
const output = {
  pr_number: String(pull.number),
  head_sha: pull.head.sha,
  base_ref: pull.base.ref,
  head_ref: pull.head.ref
};

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(output).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
} else {
  console.log(JSON.stringify(output, null, 2));
}
