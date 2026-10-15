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
  const text = String(body || "").trim();
  return /^Codex Review:/i.test(text) ||
    text.includes("<!-- codex-review-receipt:") ||
    text.includes("<!-- codex-pull-request-review-summary") ||
    text.includes("<!-- codex-review-state:");
}

export function reviewEvidenceTime(comment) {
  return comment?.updated_at || comment?.created_at;
}

export function isAfterReviewRequest(value, marker) {
  const time = Date.parse(value || "");
  const cutoff = Date.parse(marker?.sourceCommentCreatedAt || marker?.requestedAt || marker?.commentCreatedAt || "");
  return Number.isFinite(time) && Number.isFinite(cutoff) && time >= cutoff;
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
    if (typeof value.commit_sha !== "string" || !/^[a-f0-9]{40}$/.test(value.commit_sha) || typeof value.status !== "string" ||
        typeof value.has_any_findings !== "boolean" || typeof value.has_unresolved_findings !== "boolean" ||
        (!value.has_any_findings && value.has_unresolved_findings)) return null;
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
  if (containsBlockingSeverity(body, "codex") || /Codex Review:|\bfound\s+(?:a|[1-9])\b|changes.requested/i.test(body.slice(envelope[0].length))) return { result: "fail", explicitSha: true };
  const security = state.security_review;
  if (code.has_any_findings || code.has_unresolved_findings || security.has_any_findings || security.has_unresolved_findings) {
    return { result: "fail", explicitSha: true };
  }
  const securityCompleted = security.status === null || (security.commit_sha === headSha && security.status === "completed");
  return { result: code.status === "completed" && securityCompleted ? "pass" : "pending", explicitSha: true };
}

export function classifyCodexSummaryComment(comment, headSha, requestMarker = null, config = {}) {
  if (!isTrustedReviewLogin(comment?.user?.login, "codex", config)) return null;
  const body = String(comment?.body || "").trim();
  if (body.includes("codex-pull-request-review-summary") || body.includes("codex-review-state:")) {
    return parseStructuredCodexSummary(body, headSha);
  }
  const receipt = body.startsWith("<!-- codex-review-receipt:v1 -->");
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
  const visibleHashes = text.split(/<details\b/i)[0].match(/\b[a-f0-9]{10,40}\b/g) || [];
  if (visibleHashes.some((sha) => !String(headSha).startsWith(sha))) return null;
  if (containsBlockingSeverity(text, "codex")) return { result: "fail", explicitSha };
  const positive = /^Codex Review:\s*did(?:\s+not|\s*n['’]?t)\s+find\s+any\s+major\s+issues\b/i.test(text);
  // Only the observed no-findings sentence is a positive verdict. Contradictory
  // prose (outside the optional standard help section) must fail closed.
  const verdictText = text.split(/<details\b/i)[0];
  const conflict = /\b(?:found|unresolved|incomplete|pending|in.progress|changes.requested|failed)\b/i.test(verdictText);
  return { result: positive && !conflict ? "pass" : "fail", explicitSha };
}

export function isAcceptableCodexSummaryComment(comment, headSha, requestMarker = null, config = {}) {
  return classifyCodexSummaryComment(comment, headSha, requestMarker, config)?.result === "pass";
}

export function evaluateCodexEvidence({ comments = [], reviews = [], reviewComments = [], threads = [], timeline = [], headSha, requestMarker, config = {} }) {
  // All unresolved Codex findings block, including advisory and old-head threads.
  // Request markers only set the evidence cutoff; they cannot resolve findings.
  if (threads.some((thread) => !thread.isResolved && thread.comments?.nodes?.some((comment) =>
    isTrustedReviewLogin(comment.author?.__typename === "Bot" && !comment.author.login.endsWith("[bot]")
      ? `${comment.author.login}[bot]` : comment.author?.login, "codex", config)))) return "fail";
  const candidates = [];
  for (const review of reviews) {
    const result = classifyCodexNativeReview(review, reviewComments, headSha, config);
    if (result && (result === "fail" || isAfterReviewRequest(review.submitted_at, requestMarker))) {
      candidates.push({ result, time: Date.parse(review.submitted_at || "") });
    }
  }
  for (const comment of comments) {
    const parsed = classifyCodexSummaryComment(comment, headSha, requestMarker, config);
    if (!parsed) {
      if (isTrustedReviewLogin(comment.user?.login, "codex", config) && isCodexReviewSignal(comment.body)) {
        candidates.push({ result: "pending", time: Date.parse(reviewEvidenceTime(comment) || "") });
      }
      continue;
    }
    const timestamp = parsed.explicitSha ? reviewEvidenceTime(comment) : comment.created_at;
    if (!isAfterReviewRequest(timestamp, requestMarker) && parsed.result !== "fail") continue;
    if (!parsed.explicitSha && hasHeadUpdateBetweenTimestamps(timeline,
      requestMarker?.sourceCommentCreatedAt || requestMarker?.requestedAt, timestamp)) continue;
    candidates.push({ result: parsed.result, time: Date.parse(timestamp || "") });
  }
  const valid = candidates.filter((entry) => Number.isFinite(entry.time));
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

export function classifyCodexNativeReview(review, reviewComments = [], headSha, config = {}) {
  if (!review) return null;
  if (!headSha || review.commit_id !== headSha) return null;
  const login = normalizeLogin(review.user?.login);
  if (!isTrustedReviewLogin(login, "codex", config)) return null;
  if (containsBlockingSeverity(review.body, "codex")) return "fail";

  if (review.state === "APPROVED") return "pass";
  if (review.state === "CHANGES_REQUESTED") return "fail";
  if (review.state !== "COMMENTED") return null;

  const commentsForReview = reviewComments.filter((comment) =>
    comment.pull_request_review_id === review.id &&
    isTrustedReviewLogin(comment.user?.login, "codex", config)
  );
  if (commentsForReview.length === 0) return "pass";

  const priorities = commentsForReview.map((comment) => extractCodexPriority(comment.body));
  if (priorities.some((priority) => priority === null)) return "fail";
  return Math.min(...priorities) <= 2 ? "fail" : "pass";
}

export function latestCodexNativeReviewResult(reviews = [], reviewComments = [], headSha, config = {}) {
  return reviews
    .map((review) => ({
      review,
      result: classifyCodexNativeReview(review, reviewComments, headSha, config)
    }))
    .filter((entry) => entry.result !== null)
    .sort((left, right) =>
      Date.parse(right.review.submitted_at || "") - Date.parse(left.review.submitted_at || "")
    )[0]?.result || null;
}

export function isAcceptableNativeReview(review, agent, headSha, config = {}) {
  if (!review) return false;
  if (!headSha || review.commit_id !== headSha) return false;
  const login = normalizeLogin(review.user?.login);
  const body = review.body || "";

  if (agent === "codex") {
    return isTrustedReviewLogin(login, agent, config) &&
      review.state === "APPROVED" &&
      !containsBlockingSeverity(body, agent);
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
