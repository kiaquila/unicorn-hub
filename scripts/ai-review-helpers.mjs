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

export function isAcceptableNativeReview(review, agent, headSha) {
  if (!review) return false;
  if (review.commit_id && headSha && review.commit_id !== headSha) return false;
  const login = normalizeLogin(review.user?.login);
  const body = review.body || "";

  if (agent === "codex") {
    const looksLikeCodex = login.includes("codex") || login.includes("chatgpt");
    return looksLikeCodex && review.state === "APPROVED" && !containsBlockingSeverity(body, agent);
  }

  if (agent === "gemini") {
    const looksLikeGemini = login.includes("gemini");
    return looksLikeGemini && !containsBlockingSeverity(body, agent);
  }

  return false;
}

export function isAcceptableClaudeComment(comment, headSha) {
  const body = comment?.body || "";
  const login = normalizeLogin(comment?.user?.login);
  if (!login.includes("claude")) return false;
  if (extractMarkerSha(body) !== headSha) return false;
  return extractClaudeOutcome(body) === "pass";
}
