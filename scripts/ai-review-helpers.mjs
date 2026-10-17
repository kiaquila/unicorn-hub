export const trustedAssociations = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function isTrustedAssociation(value) {
  return trustedAssociations.has(String(value || "").toUpperCase());
}

export function extractClaudeOutcome(body) {
  const match = String(body || "").match(/^AI_REVIEW_OUTCOME:\s*(pass|advisory|block)\s*$/im);
  return match?.[1]?.toLowerCase() || null;
}

export function extractMarkerSha(body) {
  const match = String(body || "").match(/^AI_REVIEW_SHA:\s*([a-f0-9]{7,40})\s*$/im);
  return match?.[1] || null;
}

export function createAiReviewRequestMarkerBody({
  agent,
  headSha,
  requestId,
  sourceCommentId,
  sourceCommentCreatedAt,
  requestedAt
}) {
  const recordedAt = requestedAt || new Date().toISOString();
  return [
    `AI review request recorded for \`${String(headSha || "").slice(0, 10)}\`.`,
    "",
    "<!-- unicorn-hub:ai-review-request",
    `AI_REVIEW_REQUEST_ID: ${requestId}`,
    `AI_REVIEW_AGENT: ${String(agent || "").trim().toLowerCase()}`,
    `AI_REVIEW_SHA: ${headSha}`,
    `AI_REVIEW_SOURCE_COMMENT_ID: ${sourceCommentId}`,
    `AI_REVIEW_SOURCE_COMMENT_CREATED_AT: ${sourceCommentCreatedAt || recordedAt}`,
    `AI_REVIEW_REQUESTED_AT: ${recordedAt}`,
    "-->"
  ].join("\n");
}

export function extractAiReviewRequestMarker(body) {
  const text = String(body || "");
  if (!text.includes("unicorn-hub:ai-review-request")) return null;

  const field = (name) => text.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "im"))?.[1]?.trim() || null;
  const requestId = field("AI_REVIEW_REQUEST_ID");
  const agent = field("AI_REVIEW_AGENT")?.toLowerCase();
  const sha = field("AI_REVIEW_SHA");
  const sourceCommentId = field("AI_REVIEW_SOURCE_COMMENT_ID");
  const sourceCommentCreatedAt = field("AI_REVIEW_SOURCE_COMMENT_CREATED_AT");
  const requestedAt = field("AI_REVIEW_REQUESTED_AT");

  if (!requestId || !agent || !sha || !sourceCommentId || !requestedAt) return null;
  if (!/^[a-f0-9]{7,40}$/i.test(sha)) return null;

  return {
    requestId,
    agent,
    sha,
    sourceCommentId,
    sourceCommentCreatedAt,
    requestedAt
  };
}

export function normalizeLogin(login) {
  return String(login || "").toLowerCase();
}

const defaultTrustedReviewLogins = {
  codex: ["chatgpt-codex-connector[bot]"],
  claude: ["claude[bot]"],
  gemini: ["gemini-code-assist[bot]"]
};

export function trustedReviewLoginsForAgent(agent, config = {}) {
  return new Set([
    ...(defaultTrustedReviewLogins[agent] || []),
    ...(config.trustedReviewLogins || []),
    ...(config.trustedReviewLoginsByAgent?.[agent] || [])
  ].map(normalizeLogin));
}

export function isTrustedReviewLogin(login, agent, config = {}) {
  return trustedReviewLoginsForAgent(agent, config).has(normalizeLogin(login));
}

export function isAiReviewRequestMarkerComment(comment, agent, headSha) {
  const login = normalizeLogin(comment?.user?.login);
  if (login !== "github-actions[bot]") return false;
  const marker = extractAiReviewRequestMarker(comment?.body);
  if (!marker) return false;
  return marker.agent === String(agent || "").toLowerCase() && marker.sha === headSha;
}

export function latestAiReviewRequestMarker(comments = [], agent, headSha) {
  return comments
    .map((comment) => {
      const marker = extractAiReviewRequestMarker(comment?.body);
      if (!marker) return null;
      return {
        ...marker,
        commentId: String(comment.id || ""),
        commentCreatedAt: comment.created_at || null,
        author: comment.user?.login || null
      };
    })
    .filter((marker) =>
      marker &&
      normalizeLogin(marker.author) === "github-actions[bot]" &&
      marker.agent === String(agent || "").toLowerCase() &&
      marker.sha === headSha
    )
    .sort((left, right) =>
      Date.parse(right.commentCreatedAt || right.requestedAt || "") -
      Date.parse(left.commentCreatedAt || left.requestedAt || "")
    )[0] || null;
}

export function containsBlockingSeverity(body, agent) {
  const text = String(body || "");
  if (agent === "codex") {
    return /\bP[0-2]\b/i.test(text);
  }
  if (agent === "gemini") {
    return /\b(critical|high)\b/i.test(text);
  }
  return false;
}

export function extractCodexPriority(body) {
  const match = String(body || "").match(/\bP([0-3])\b/i);
  return match ? Number(match[1]) : null;
}

// Routing is deliberately broader than acceptance: even a negative or malformed
// edit must wake the gate so an earlier successful result cannot remain green.
export function isCodexReviewSignal(body) {
  const text = String(body || "");
  return /^Codex Review:/i.test(text) ||
    text.includes("<!-- codex-review-receipt:") ||
    text.includes("<!-- codex-pull-request-review-summary") ||
    text.includes("<!-- codex-review-state:");
}

function priorBodyFromEditDiff(diff) {
  // Reconstruct only the prior side. Added or quoted review-like prose is not
  // evidence that a native verdict was withdrawn.
  const markup = String(diff);
  const decodeText = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_match, code) => {
      const value = code[0].toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number(code);
      return value <= 0x10ffff ? String.fromCodePoint(value) : "";
    });
  if (/<(?:del|ins)\b/i.test(markup)) {
    // Keep text and evidence-bearing HTML comments, not tag names/attributes.
    // Structural tags leave a boundary so quoted text cannot move to column zero.
    const tokens = /<!--[\s\S]*?-->|<(\/?)([a-z][\w:-]*)(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
    const prior = [];
    let cursor = 0;
    let insertionDepth = 0;
    for (const token of markup.matchAll(tokens)) {
      if (insertionDepth === 0) prior.push(decodeText(markup.slice(cursor, token.index)));
      const tag = token[2]?.toLowerCase();
      if (tag === "ins") {
        if (token[1]) insertionDepth = Math.max(0, insertionDepth - 1);
        else if (!/\/>$/.test(token[0])) insertionDepth++;
      } else if (insertionDepth === 0 && tag !== "del") {
        prior.push(tag ? "\n" : decodeText(token[0]));
      }
      cursor = token.index + token[0].length;
    }
    if (insertionDepth === 0) prior.push(decodeText(markup.slice(cursor)));
    return prior.join("");
  }
  const decoded = decodeText(markup);
  const lines = decoded.split("\n");
  const firstHunk = lines.findIndex((line) => /^@@ /.test(line));
  if (firstHunk >= 0 ||
      (lines.some((line) => line.startsWith("-")) && lines.some((line) => line.startsWith("+")))) {
    const prior = lines.filter((line, index) => {
      if (/^(?:\+|@@|\\ No newline)/.test(line)) return false;
      if (index < firstHunk && (/^(?:diff |index )/.test(line) ||
          (/^---[\t ]/.test(line) && /^\+\+\+[\t ]/.test(lines[index + 1] || "")))) return false;
      return true;
    })
      .map((line) => /^[ -]/.test(line) ? line.slice(1) : line).join("\n");
    // A partial hunk below line one cannot establish a start-of-body legacy
    // verdict. Explicit envelopes still retain their anywhere-in-body grammar.
    return firstHunk >= 0 && !/^@@ -[01](?:[ ,])/.test(lines[firstHunk]) ? `\n${prior}` : prior;
  }
  return decoded;
}

export function hasCodexReviewSignalInEditDiff(diff) {
  return isCodexReviewSignal(priorBodyFromEditDiff(diff));
}

export function isCodexStructuredSummarySignal(body) {
  return /codex-pull-request-review-summary|codex-review-state:/.test(String(body || ""));
}

export function hasCodexStructuredSummaryInEditDiff(diff) {
  return isCodexStructuredSummarySignal(priorBodyFromEditDiff(diff));
}

export function isAiReviewControlComment(body) {
  const text = String(body || "");
  return (text.startsWith("AI review request recorded for ") && Boolean(extractAiReviewRequestMarker(text))) ||
    text.startsWith("<!-- unicorn-hub:ai-review-withdrawal:");
}

export function reviewEvidenceTime(comment) {
  return comment?.updated_at || comment?.created_at;
}

function containsNegativeReviewState(text) {
  const plain = String(text).replace(/_/g, " ").replace(/[*`~]/g, "");
  const negativeState = /\b(?:unresolved|incomplete|pending|in[\s./:-]*progress|changes[\s./:-]*requested|fail(?:ed|ure)?|running|queued|cancel(?:led|ed)|error(?:ed)?|blocked|unknown|withdraw(?:n|al|ing)?|revok(?:e|ed|ing)|revocation|retracted|rescinded|rejected|declined|denied|aborted|abandoned|paused|suspended|skipped|stopped|terminated|expired|invalid|unavailable|inconclusive|deferred|unsuccessful|stale|outdated|superseded|waiting|timed[\s./:-]*out|action[\s./:-]*required)\b/i;
  const negatedSuccess = /\b(?:not|never|no[\s./:-]*longer|(?:has|have|had|is|was|were|could|did|does|do)n['’]t|can['’]t|won['’]t|cannot|unable[\s./:-]*to)(?:[\s./:-]*(?:yet|fully|be|been|being|to))*[\s./:-]*(?:complet(?:e|ed)|finish(?:ed)?|approv(?:e|ed)|start(?:ed)?|review(?:ed)?|pass(?:ed)?|valid(?:ate|ated)?|ready|done|success(?:ful(?:ly)?)?|available)\b/i;
  return negativeState.test(plain) || negatedSuccess.test(plain);
}

const codexHelpIntroduction = `[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you
- Open a pull request for review
- Mark a draft as ready
- Comment "@codex review"`;
const codexHelpFooters = [
  codexHelpIntroduction + ` or "@codex security review".
Codex reacts with 👀 while any review is running, comments if it has suggestions, and reacts with 👍 once all reviews finish with no findings.`,
  codexHelpIntroduction + `.
If Codex has suggestions, it will comment; otherwise it will react with 👍.
Codex can also answer questions or update the PR. Try commenting "@codex address that feedback".`
].map((text) => text.replace(/\s+/g, " ").trim());

function withoutCodexHelpFooter(text) {
  const body = String(text);
  const footer = body.match(/\s*<details>\s*<summary>ℹ️ About Codex in GitHub<\/summary>\s*<br\/>\s*((?:(?!<\/?details\b)[\s\S])*)<\/details>\s*$/);
  if (!footer || !codexHelpFooters.includes(footer[1].replace(/\s+/g, " ").trim())) return body;
  return body.slice(0, footer.index);
}

export function isAfterReviewRequest(value, marker) {
  const time = Date.parse(value || "");
  const cutoff = Date.parse(marker?.sourceCommentCreatedAt || marker?.requestedAt || marker?.commentCreatedAt || "");
  return Number.isFinite(time) && Number.isFinite(cutoff) && time >= cutoff;
}

function isPositiveSummaryRendering(text, headSha, securityActive) {
  const visible = withoutCodexHelpFooter(text).trim();
  const lines = visible.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.shift() !== "This comment shows the latest Codex review activity on this pull request." ||
      lines.shift() !== "| Review | Status | Commit | Review trigger |" ||
      lines.shift() !== "| --- | --- | --- | --- |") return false;
  const seen = new Set();
  for (const line of lines) {
    const row = line.match(/^\| (?:📝|🛡️) \*\*(Code Review|Security Review)\*\* \| ✅ \*\*Completed\*\*(?: <relative-time datetime="([^"<>]+)">([^<>]+)<\/relative-time>)? \| `([a-f0-9]{7,40})` \| (?:Manual request|Automatic review) \|$/);
    if (!row || seen.has(row[1]) || !headSha.startsWith(row[4]) ||
        (row[2] && (row[2] !== row[3] || !Number.isFinite(Date.parse(row[2]))))) return false;
    seen.add(row[1]);
  }
  return seen.has("Code Review") && seen.size === (securityActive ? 2 : 1) &&
    (!securityActive || seen.has("Security Review"));
}

function parseStructuredCodexSummary(body, headSha) {
  const envelope = body.match(/^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 (.+?) -->\s*## Codex Review Summary(?:\s|$)/s);
  if (!envelope || (body.match(/codex-pull-request-review-summary/g) || []).length !== 1 ||
      (body.match(/codex-review-state:/g) || []).length !== 1 || body.includes("codex-review-receipt:")) return null;
  let state;
  try { state = JSON.parse(envelope[1]); } catch { return null; }
  const keysAre = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
  if (!keysAre(state, ["code_review", "security_review"])) return null;
  for (const [name, value] of Object.entries(state)) {
    if (!keysAre(value, ["commit_sha", "has_any_findings", "has_unresolved_findings", "status"])) return null;
    if (name === "security_review" && Object.values(value).every((field) => field === null)) continue;
    const knownFindings = typeof value.has_any_findings === "boolean" && typeof value.has_unresolved_findings === "boolean";
    const omittedCodeFindings = name === "code_review" && value.has_any_findings === null && value.has_unresolved_findings === null;
    if (typeof value.commit_sha !== "string" || !/^[a-f0-9]{40}$/.test(value.commit_sha) || typeof value.status !== "string" ||
        (!knownFindings && !omittedCodeFindings) || (!value.has_any_findings && value.has_unresolved_findings)) return null;
  }
  // Decode key spellings too, so escaped duplicate JSON fields cannot override
  // an earlier negative value under a second spelling of the same key.
  const keys = [...envelope[1].matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map((match) => JSON.parse(match[1]));
  for (const key of ["code_review", "security_review", "commit_sha", "has_any_findings", "has_unresolved_findings", "status"]) {
    const expected = ["code_review", "security_review"].includes(key) ? 1 : 2;
    if (keys.filter((value) => value === key).length !== expected) return null;
  }
  const code = state.code_review;
  if (code.commit_sha !== headSha) return null;
  // Conflicting visible severity or a second verdict cannot be hidden by JSON.
  const visibleVerdict = withoutCodexHelpFooter(body.slice(envelope[0].length));
  if (containsBlockingSeverity(body, "codex") || containsNegativeReviewState(visibleVerdict) ||
      /Codex Review:|\bfound\s+(?:a|[1-9])\b/i.test(visibleVerdict)) return { result: "fail", explicitSha: true };
  const security = state.security_review;
  if (code.has_any_findings || code.has_unresolved_findings || security.has_any_findings || security.has_unresolved_findings) {
    return { result: "fail", explicitSha: true };
  }
  const securityCompleted = security.status === null || (security.commit_sha === headSha && security.status === "completed");
  const completed = code.status === "completed" && securityCompleted;
  const positiveRendering = completed && isPositiveSummaryRendering(visibleVerdict, headSha, security.status !== null);
  if (positiveRendering && code.has_any_findings === null && code.has_unresolved_findings === null) {
    // The native backend omits code findings flags when it publishes a separate
    // no-findings receipt. Null is never a positive verdict on its own.
    return { result: "pending", explicitSha: true, requiresCodeReceipt: true };
  }
  return { result: positiveRendering ? "pass" : "pending", explicitSha: true };
}

export function classifyCodexSummaryComment(comment, headSha, requestMarker = null, config = {}) {
  if (!isTrustedReviewLogin(comment?.user?.login, "codex", config)) return null;
  const body = String(comment?.body || "").trim();
  if (body.includes("codex-pull-request-review-summary") || body.includes("codex-review-state:")) {
    return parseStructuredCodexSummary(body, headSha);
  }
  const receipt = body.startsWith("<!-- codex-review-receipt:v1 -->");
  // Legacy verdicts start at column zero, matching Actions startsWith exactly.
  // Structured envelopes and receipts retain their explicit marker grammar.
  if (!receipt && !/^Codex Review:/i.test(String(comment.body || ""))) return null;
  const text = receipt ? body.slice("<!-- codex-review-receipt:v1 -->".length).trim() : body;
  if ((body.match(/codex-review-receipt:/g) || []).length !== Number(receipt) ||
      !/^Codex Review:/i.test(text) || (text.match(/Codex Review:/gi) || []).length !== 1) return null;

  const commitLines = [...text.matchAll(/^\*\*Reviewed commit:\*\* `([a-f0-9]{10,40})`\s*$/gm)];
  const commitLabels = (text.match(/Reviewed commit/gi) || []).length;
  if (commitLabels !== commitLines.length || commitLines.length > 1 || (receipt && commitLines.length !== 1)) return null;
  // An explicit stale/malformed binding never falls back to timestamp acceptance.
  let explicitSha = false;
  if (commitLines.length) {
    if (!String(headSha).startsWith(commitLines[0][1])) return null;
    explicitSha = true;
  } else {
    const hashes = text.match(/\b[a-f0-9]{10,40}\b/g) || [];
    if (hashes.length) {
      if (hashes.some((sha) => !String(headSha).startsWith(sha))) return null;
      explicitSha = true;
    }
  }
  if (!explicitSha && (!requestMarker || requestMarker.agent !== "codex" || requestMarker.sha !== headSha ||
      !isAfterReviewRequest(comment.created_at, requestMarker))) return null;
  const visibleHashes = withoutCodexHelpFooter(text).match(/\b[a-f0-9]{10,40}\b/g) || [];
  if (visibleHashes.some((sha) => !String(headSha).startsWith(sha))) return null;
  if (containsBlockingSeverity(text, "codex")) return { result: "fail", explicitSha };
  const positiveText = withoutCodexHelpFooter(text).replace(/^\*\*Reviewed commit:\*\* `[a-f0-9]{10,40}`\s*$/gm, "").trim();
  const positive = /^Codex Review:\s*did(?:\s+not|\s*n['’]?t)\s+find\s+any\s+major\s+issues(?: for [a-f0-9]{10,40})?\.(?: (?:Nice work!|Delightful!|Can't wait for the next one!|Already looking forward to the next diff\.|:rocket:|🚀|:\+1:))?$/i.test(positiveText);
  // Only the observed no-findings sentence is a positive verdict. Contradictory
  // prose (outside the optional standard help section) must fail closed.
  const verdictText = withoutCodexHelpFooter(text);
  const conflict = /\bfound\b/i.test(verdictText) || containsNegativeReviewState(verdictText);
  return { result: positive && !conflict ? "pass" : "fail", explicitSha };
}

export function isAcceptableCodexSummaryComment(comment, headSha, requestMarker = null, config = {}) {
  return classifyCodexSummaryComment(comment, headSha, requestMarker, config)?.result === "pass";
}

export function reviewWithdrawalPrNumber(run, { repository, defaultBranch, config = {} }) {
  const title = String(run.display_title || "").match(/^AI review evidence:(issue_comment|pull_request_review_comment):(deleted|edited):([1-9][0-9]*):([^:]+):(true|false):(true|false):(true|false)$/);
  if (typeof run.path !== "string" || run.repository?.full_name?.toLowerCase() !== repository.toLowerCase() ||
      !title || title[1] !== run.event || !Number.isFinite(Date.parse(run.created_at || ""))) return null;
  const nativeWithdrawal = isTrustedReviewLogin(title[4], "codex", config) &&
    ((title[2] === "deleted" && (title[1] === "pull_request_review_comment" || title[6] === "true")) ||
      (title[2] === "edited" && (title[6] === "true" || title[7] === "true")));
  const machineMutation = title[4].toLowerCase() === "github-actions[bot]" && title[5] === "true";
  if (!nativeWithdrawal && !machineMutation) return null;
  const prNumber = Number(title[3]);
  if (!Number.isSafeInteger(prNumber)) throw new Error("Invalid withdrawal PR number.");
  const workflowPath = ".github/workflows/ai-review-rerun.yml";
  const workflowRef = run.path.startsWith(`${workflowPath}@`) ? run.path.slice(workflowPath.length + 1) : null;
  if (run.path !== workflowPath && (!workflowRef || ![
    run.head_branch, run.head_sha, run.head_branch && `refs/heads/${run.head_branch}`,
    defaultBranch, defaultBranch && `refs/heads/${defaultBranch}`,
    ...(run.event === "pull_request_review_comment" ? [`refs/pull/${prNumber}/merge`, `refs/pull/${prNumber}/head`] : [])
  ].filter(Boolean).includes(workflowRef))) return null;

  // issue_comment definitions come from the default branch. For PR-context
  // runs, constrain this negative-only record to the API-associated PR, so a
  // contributor cannot use a forged run title to write on another PR.
  if (run.event === "issue_comment" ? !defaultBranch || run.head_branch !== defaultBranch
    : !run.pull_requests?.some((pull) => pull.number === prNumber)) return null;
  return prNumber;
}

export function hasUnrecordedReviewWithdrawals({ runs, comments, repository, defaultBranch, prNumber, config = {} }) {
  return runs.some((run) => {
    if (reviewWithdrawalPrNumber(run, { repository, defaultBranch, config }) !== Number(prNumber)) return false;
    if (!Number.isSafeInteger(run.id) || run.id <= 0) throw new Error("Invalid withdrawal source run ID.");
    return !comments.some((comment) => {
      if (normalizeLogin(comment.user?.login) !== "github-actions[bot]") return false;
      const match = String(comment.body || "").match(/^<!-- unicorn-hub:ai-review-withdrawal:v1 (.+) -->$/);
      let record;
      try { record = match && JSON.parse(match[1]); } catch { return false; }
      if (!record || !/^[a-f0-9]{40}$/.test(record.head_sha || "")) return false;
      const expected = { agent: "codex", head_sha: record.head_sha, pr_number: Number(prNumber),
        source_created_at: run.created_at, source_run_id: run.id };
      return match[1] === JSON.stringify(expected) &&
        Number.isFinite(Date.parse(comment.created_at || "")) && Date.parse(comment.created_at) >= Date.parse(run.created_at);
    });
  });
}

export function evaluateCodexEvidence({ comments = [], reviews = [], reviewComments = [], threads = [], timeline = [], headSha, requestMarker, config = {} }) {
  // All unresolved Codex findings block, including advisory and old-head threads.
  // Request markers only set the evidence cutoff; they cannot resolve findings.
  if (threads.some((thread) => !thread.isResolved && thread.comments?.nodes?.some((comment) =>
    isTrustedReviewLogin(comment.author?.__typename === "Bot" && !comment.author.login.endsWith("[bot]")
      ? `${comment.author.login}[bot]` : comment.author?.login, "codex", config)))) return "fail";
  // The mutable native summary covers the whole review, including active
  // security work. A later code-only receipt/approval cannot erase that state.
  const summaries = comments.filter((comment) => isTrustedReviewLogin(comment.user?.login, "codex", config) &&
    isCodexStructuredSummarySignal(comment.body));
  let latestSummaryTime = -Infinity;
  let latestSummaries = [];
  if (summaries.length) {
    const times = summaries.map((comment) => Date.parse(reviewEvidenceTime(comment) || ""));
    if (times.some((time) => !Number.isFinite(time))) return "pending";
    latestSummaryTime = Math.max(...times);
    latestSummaries = summaries.filter((_comment, index) => times[index] === latestSummaryTime);
  }
  let withdrawalTime = -Infinity;
  for (const comment of comments) {
    if (normalizeLogin(comment.user?.login) !== "github-actions[bot]" ||
        !String(comment.body || "").includes("unicorn-hub:ai-review-withdrawal:")) continue;
    const match = String(comment.body).match(/^<!-- unicorn-hub:ai-review-withdrawal:v1 (.+) -->$/);
    let record;
    try { record = match && JSON.parse(match[1]); } catch { return "pending"; }
    if (!record || JSON.stringify(record) !== match[1] || Object.keys(record).sort().join(",") !== "agent,head_sha,pr_number,source_created_at,source_run_id" ||
        record.agent !== "codex" || !/^[a-f0-9]{40}$/.test(record.head_sha) ||
        !Number.isSafeInteger(record.pr_number) || record.pr_number <= 0 ||
        !Number.isSafeInteger(record.source_run_id) || record.source_run_id <= 0 ||
        !Number.isFinite(Date.parse(record.source_created_at || "")) ||
        !Number.isFinite(Date.parse(comment.created_at || "")) ||
        Date.parse(record.source_created_at) > Date.parse(comment.created_at)) return "pending";
    if (record.head_sha === headSha) withdrawalTime = Math.max(withdrawalTime, Date.parse(record.source_created_at));
  }
  // A removed whole-review snapshot cannot be replaced by code-only evidence.
  // Deletion records cannot recover the vanished body, so conservatively require
  // a newer complete structured snapshot for every durable withdrawal.
  let structuredWithdrawalTime = withdrawalTime;
  for (const comment of comments) {
    if (isTrustedReviewLogin(comment.user?.login, "codex", config) && comment.prior_structured_summary === true &&
        !isCodexStructuredSummarySignal(comment.body)) {
      const time = Date.parse(reviewEvidenceTime(comment) || "");
      if (!Number.isFinite(time)) return "pending";
      structuredWithdrawalTime = Math.max(structuredWithdrawalTime, time);
    }
  }
  const effectiveCommentResult = (comment) => {
    const parsed = classifyCodexSummaryComment(comment, headSha, requestMarker, config);
    if (!parsed?.requiresCodeReceipt) return parsed;
    const receiptTimes = comments.flatMap((receipt) => {
      if (!String(receipt.body || "").trim().startsWith("<!-- codex-review-receipt:v1 -->") ||
          !isAfterReviewRequest(receipt.created_at, requestMarker) ||
          !(Date.parse(receipt.created_at || "") > structuredWithdrawalTime)) return [];
      const verdict = classifyCodexSummaryComment(receipt, headSha, requestMarker, config);
      return verdict?.result === "pass" && verdict.explicitSha === true ? [Date.parse(receipt.created_at)] : [];
    });
    return { ...parsed, result: receiptTimes.length ? "pass" : "pending", corroborationTime: Math.max(...receiptTimes) };
  };
  const summaryResults = latestSummaries.map((comment) => effectiveCommentResult(comment)?.result || "pending");
  if (summaryResults.includes("fail")) return "fail";
  if (summaryResults.includes("pending")) return "pending";
  if (Number.isFinite(structuredWithdrawalTime) && latestSummaryTime <= structuredWithdrawalTime) return "pending";
  const candidates = [];
  for (const review of reviews) {
    const result = classifyCodexNativeReview(review, reviewComments, headSha, config, requestMarker);
    if (result && (result !== "pass" || isAfterReviewRequest(review.submitted_at, requestMarker))) {
      candidates.push({ result, time: nativeReviewEvidenceTime(review, reviewComments, result, config) });
    }
  }
  for (const comment of comments) {
    const parsed = effectiveCommentResult(comment);
    if (!parsed) {
      // The gate verifies prior signal membership from server edit history.
      // Ordinary bot replies cannot invalidate an unrelated completed review.
      if (isTrustedReviewLogin(comment.user?.login, "codex", config) &&
          (isCodexReviewSignal(comment.body) || comment.prior_review_signal === true)) {
        candidates.push({ result: "pending", time: Date.parse(reviewEvidenceTime(comment) || "") });
      }
      continue;
    }
    // Only a structured snapshot carries a new whole-review verdict on edit.
    // Code-only receipts/legacy positives retain their original publication age.
    const eligibilityTime = parsed.explicitSha && isCodexStructuredSummarySignal(comment.body)
      ? reviewEvidenceTime(comment) : comment.created_at;
    if (!isAfterReviewRequest(eligibilityTime, requestMarker) && parsed.result !== "fail") continue;
    if (!parsed.explicitSha && hasHeadUpdateBetweenTimestamps(timeline,
      requestMarker?.sourceCommentCreatedAt || requestMarker?.requestedAt, eligibilityTime)) continue;
    // An edit cannot refresh SHA-less request/head eligibility, but an accepted
    // negative edit must invalidate a positive verdict posted before the edit.
    const orderingTime = parsed.result === "fail" ? reviewEvidenceTime(comment) : eligibilityTime;
    const evidenceTime = Date.parse(orderingTime || "");
    // A summary cannot renew its receipt's older verdict and erase intervening
    // negative or incomplete evidence. The pair is only as new as both parts.
    candidates.push({ result: parsed.result, time: parsed.result === "pass" && parsed.requiresCodeReceipt
      ? Math.min(evidenceTime, parsed.corroborationTime) : evidenceTime });
  }
  const valid = candidates.filter((entry) => Number.isFinite(entry.time) &&
    (entry.result !== "pass" || entry.time > withdrawalTime));
  const newest = Math.max(...valid.map((entry) => entry.time));
  const latest = valid.filter((entry) => entry.time === newest);
  if (latest.some((entry) => entry.result === "fail")) return "fail";
  if (latest.some((entry) => entry.result === "pending")) return "pending";
  return latest.some((entry) => entry.result === "pass") ? "pass" : "pending";
}

export function hasHeadUpdateBetweenTimestamps(timeline = [], startCreatedAt, endCreatedAt) {
  const startTime = Date.parse(startCreatedAt || "");
  const endTime = Date.parse(endCreatedAt || "");
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) return true;
  return timeline.some((event) => {
    if (event.event !== "committed" && event.event !== "head_ref_force_pushed") return false;
    const eventTime = Date.parse(event.created_at || event.committer?.date || "");
    return Number.isFinite(eventTime) && eventTime > startTime && eventTime <= endTime;
  });
}

function nativeReviewEvidenceTime(review, reviewComments, result, config) {
  const times = [result === "pass" ? review.submitted_at : (review.updated_at || review.submitted_at)];
  if (result === "fail") {
    times.push(...reviewComments.filter((comment) => comment.pull_request_review_id === review.id &&
      isTrustedReviewLogin(comment.user?.login, "codex", config) &&
      (extractCodexPriority(comment.body) === null || extractCodexPriority(comment.body) <= 2)).map(reviewEvidenceTime));
  }
  return Math.max(...times.map((time) => Date.parse(time || "")).filter(Number.isFinite));
}

export function classifyCodexNativeReview(review, reviewComments = [], headSha, config = {}, requestMarker = null) {
  if (!review) return null;
  if (!headSha || review.commit_id !== headSha) return null;
  const login = normalizeLogin(review.user?.login);
  if (!isTrustedReviewLogin(login, "codex", config)) return null;
  if (containsBlockingSeverity(review.body, "codex") ||
      containsNegativeReviewState(withoutCodexHelpFooter(review.body))) return "fail";

  if (["CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) return "fail";
  if (!["APPROVED", "COMMENTED"].includes(review.state)) return null;

  const commentsForReview = reviewComments.filter((comment) =>
    comment.pull_request_review_id === review.id &&
    isTrustedReviewLogin(comment.user?.login, "codex", config)
  );
  const priorities = commentsForReview.map((comment) => extractCodexPriority(comment.body));
  if (priorities.some((priority) => priority === null || priority <= 2)) return "fail";
  // COMMENTED is only an implicit no-findings verdict at submission. Body
  // edits can withdraw that verdict without changing GitHub's review state.
  if (review.state === "COMMENTED" && review.last_edited_at) return "pending";
  const visible = withoutCodexHelpFooter(review.body || "").trim();
  // Missing inline comments cannot establish a positive verdict: they may have
  // been deleted. Require explicit fresh evidence rather than implicit success.
  if (!visible) return "pending";
  const parsed = classifyCodexSummaryComment({ ...review, created_at: review.submitted_at }, headSha, requestMarker, config);
  if (parsed) return parsed.result;
  if (isCodexReviewSignal(visible)) return "pending";
  if (/^(?:approved|lgtm|looks good(?: to me)?|no (?:major )?issues(?: found)?)[.!]?$/i.test(visible)) return "pass";
  const hashes = visible.match(/\b[a-f0-9]{10,40}\b/g) || [];
  if (hashes.some((sha) => !headSha.startsWith(sha))) return "pending";
  const bodyPriority = extractCodexPriority(visible);
  if (bodyPriority !== null && bodyPriority >= 3) return "pass";
  // Unknown finding prose must not inherit success from the formal state.
  return "pending";
}

export function latestCodexNativeReviewResult(reviews = [], reviewComments = [], headSha, config = {}) {
  return reviews
    .map((review) => ({
      review,
      result: classifyCodexNativeReview(review, reviewComments, headSha, config)
    }))
    .filter((entry) => entry.result !== null)
    .sort((left, right) =>
      nativeReviewEvidenceTime(right.review, reviewComments, right.result, config) -
      nativeReviewEvidenceTime(left.review, reviewComments, left.result, config)
    )[0]?.result || null;
}

export function isAcceptableNativeReview(review, agent, headSha, config = {}) {
  if (!review) return false;
  if (!headSha || review.commit_id !== headSha) return false;
  const login = normalizeLogin(review.user?.login);
  const body = review.body || "";

  if (agent === "codex") {
    return review.state === "APPROVED" && classifyCodexNativeReview(review, [], headSha, config) === "pass";
  }

  if (agent === "gemini") {
    return isTrustedReviewLogin(login, agent, config) && !containsBlockingSeverity(body, agent);
  }

  return false;
}

export function isAcceptableClaudeComment(comment, headSha, config = {}) {
  const body = comment?.body || "";
  const login = normalizeLogin(comment?.user?.login);
  if (!isTrustedReviewLogin(login, "claude", config)) return false;
  if (extractMarkerSha(body) !== headSha) return false;
  return extractClaudeOutcome(body) === "pass";
}
