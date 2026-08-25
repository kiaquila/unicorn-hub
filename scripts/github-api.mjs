import { spawnSync } from "node:child_process";

const API_VERSION = "2022-11-28";

function failureMessage(result, command) {
  const detail = String(result.stderr || result.stdout || "").trim();
  return detail || `${command} exited with status ${result.status ?? "unknown"}`;
}

export function runGh(gh, args, { cwd = process.cwd(), input } = {}) {
  const result = spawnSync(gh, args, {
    cwd,
    encoding: "utf8",
    input,
    maxBuffer: 16 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  return result;
}

export function ghJson(gh, args, options = {}) {
  const result = runGh(gh, args, options);
  if (result.status !== 0) {
    throw new Error(failureMessage(result, `${gh} ${args.join(" ")}`));
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub CLI returned invalid JSON for '${args.join(" ")}'.`);
  }
}

export function discoverRepository(gh, { cwd = process.cwd(), repo } = {}) {
  const args = ["repo", "view"];
  if (repo) args.push(repo);
  args.push("--json", "nameWithOwner,defaultBranchRef");
  const value = ghJson(gh, args, { cwd });
  const nameWithOwner = String(value.nameWithOwner || "").trim();
  const defaultBranch = String(value.defaultBranchRef?.name || "").trim();
  if (!nameWithOwner || !defaultBranch) {
    throw new Error("Could not determine the GitHub repository and default branch with gh repo view.");
  }
  return { repo: nameWithOwner, defaultBranch };
}

export function ghApi(gh, { method = "GET", path, body, cwd = process.cwd() }) {
  const args = [
    "api",
    "--include",
    "--method",
    method,
    "-H",
    "Accept: application/vnd.github+json",
    "-H",
    `X-GitHub-Api-Version: ${API_VERSION}`,
    path
  ];
  const input = body === undefined ? undefined : JSON.stringify(body);
  if (input !== undefined) args.push("--input", "-");
  const result = runGh(gh, args, { cwd, input });
  const output = String(result.stdout || "").replace(/\r\n/g, "\n");
  const headerEnd = output.indexOf("\n\n");
  const header = headerEnd === -1 ? output : output.slice(0, headerEnd);
  const responseBody = headerEnd === -1 ? "" : output.slice(headerEnd + 2);
  const statusMatch = header.match(/^HTTP\/\S+\s+(\d{3})\b/m);
  if (!statusMatch) {
    throw new Error(failureMessage(result, `${gh} api ${method} ${path}`));
  }
  const status = Number(statusMatch[1]);
  let json = null;
  if (responseBody.trim()) {
    try {
      json = JSON.parse(responseBody);
    } catch {
      json = null;
    }
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    body: responseBody,
    json,
    stderr: String(result.stderr || "")
  };
}

export function responseMessage(response) {
  return String(response.json?.message || response.body || response.stderr || `HTTP ${response.status}`)
    .replace(/\s+/g, " ")
    .trim();
}
