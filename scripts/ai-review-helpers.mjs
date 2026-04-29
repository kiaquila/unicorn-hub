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

export function containsBlockingSeverity(body, agent) {
  const text = String(body || "");
  if (agent === "codex") {
    return /\bP[0-2]\b/.test(text);
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

export function isAcceptableCodexSummaryComment(comment, headSha, config = {}) {
  const body = String(comment?.body || "").trim();
  const login = normalizeLogin(comment?.user?.login);
  const shortSha = String(headSha || "").slice(0, 10);
  return isTrustedReviewLogin(login, "codex", config) &&
    /^Codex Review:/i.test(body) &&
    Boolean(shortSha) &&
    (body.includes(headSha) || body.includes(shortSha)) &&
    /did(?:\s+not|\s*n['’]?t)\s+find\s+any\s+major\s+issues/i.test(body);
}

export function classifyCodexNativeReview(review, reviewComments = [], headSha, config = {}) {
  if (!review) return null;
  if (review.commit_id && headSha && review.commit_id !== headSha) return null;
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
  if (review.commit_id && headSha && review.commit_id !== headSha) return false;
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
