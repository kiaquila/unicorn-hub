const CODEX_RECEIPT_ENCOURAGEMENTS = new Set([
  "🚀",
  "🎉",
  "",
  ":+1:",
  ":rocket:",
  ":tada:",
  "Already looking forward to the next diff.",
  "Another round soon, please!",
  "Bravo.",
  "Breezy!",
  "Can't wait for the next one!",
  "Chef's kiss.",
  "Delightful!",
  "Hooray!",
  "Keep it up!",
  "Keep them coming!",
  "More of your lovely PRs please.",
  "Nice work!",
  "Swish!",
  "What shall we delve into next?",
  "You're on a roll."
]);

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
    return /\bP[0-2]\b/i.test(visibleReviewText(text));
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
    /<!-- codex-(?:review-receipt:|pull-request-review-summary|review-state:)/i.test(text);
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
  return /codex-pull-request-review-summary|codex-review-state:/i.test(String(body || ""));
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

function markdownTableCells(line) {
  const value = String(line).trim();
  const cells = []; let cursor = 0;
  for (let index = 0; index < value.length; index++) if (value[index] === "|" && markdownLinkOpenerAllowed(value, index)) {
    cells.push(value.slice(cursor, index).trim()); cursor = index + 1;
  }
  if (!cells.length) return null;
  cells.push(value.slice(cursor).trim());
  if (value.startsWith("|")) cells.shift();
  if (value.endsWith("|") && markdownLinkOpenerAllowed(value, value.length - 1)) cells.pop();
  return cells;
}

function isMarkdownTableBoundary(header, delimiter) {
  const heading = markdownTableCells(header), cells = markdownTableCells(delimiter);
  return Boolean(heading && cells && heading.length === cells.length && cells.length && cells.every(cell => /^:?-+:?$/.test(cell)));
}

function withoutAuthorityHtmlBlocks(value, htmlRanges = null) {
  // GFM HTML block classes: raw-text/declaration terminators, then blank-line blocks.
  const blockTags = /^(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)$/i;
  const completeTag = /^ {0,3}<(?:\/[a-z][a-z0-9-]*\s*|[a-z][a-z0-9-]*(?:\s+[a-z_:][a-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?)>[ \t]*$/i;
  let result = "", end = null, blankTerminated = false, offset = 0, detailsDepth = 0, htmlContainer = null, paragraphFrames = null, tableActive = false, previousContent = "";
  for (const line of value.split(/(?<=\n)/)) {
    const context = markdownContainerContext(line);
    if (paragraphFrames && markdownContainerContinuation(line, paragraphFrames) === null) paragraphFrames = null;
    if (!end && !blankTerminated && !detailsDepth) htmlContainer = null;
    let content = htmlContainer ? markdownContainerContinuation(line, htmlContainer.frames) : context.content;
    if (content === null) { end = null; blankTerminated = false; detailsDepth = 0; htmlContainer = null; content = context.content; }
    if (blankTerminated && /^\s*$/.test(content)) { end = null; blankTerminated = false; }
    if (!end && !blankTerminated) {
      const raw = content.match(/^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i);
      const block = content.match(/^ {0,3}<\/?([a-z][a-z0-9-]*)(?=[\s/>]|$)/i);
      if (raw) end = new RegExp("</" + raw[1] + "\\s*>", "i");
      else if (/^ {0,3}<!--/.test(content)) end = /(?:^ {0,3}<!--(?:>|->)|--!?>)/;
      else if (/^ {0,3}<\?/.test(content)) end = /\?>/;
      else if (/^ {0,3}<!\[CDATA\[/.test(content)) end = /\]\]>/;
      else if (/^ {0,3}<![A-Z]/.test(content)) end = />/;
      else if ((block && blockTags.test(block[1])) || (!paragraphFrames && completeTag.test(content.replace(/\r?\n$/, "")))) blankTerminated = true;
    }
    if ((end || blankTerminated) && !htmlContainer) htmlContainer = context;
    const insideDetails = detailsDepth > 0;
    if (htmlRanges === null && !end) for (const tag of content.matchAll(/<\/?details\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
      if (/^<\//.test(tag[0])) detailsDepth = Math.max(0, detailsDepth - 1); else detailsDepth++;
    }
    const hidden = Boolean(end || blankTerminated || insideDetails || detailsDepth);
    if (isMarkdownTableBoundary(previousContent, content)) tableActive = true;
    else if (tableActive && !content.includes("|")) tableActive = false;
    // Type 7 cannot interrupt a paragraph; other HTML block classes can.
    paragraphFrames = (!paragraphFrames && indentationColumns(content.match(/^[ \t]*/)[0]) >= 4) || tableActive || hidden || /^\s*$/.test(content) || /^ {0,3}(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}$)/.test(content) ? null : context.frames;
    previousContent = content;
    if (hidden && htmlRanges) htmlRanges.push([offset, offset + line.length]);
    offset += line.length;
    result += hidden ? line.replace(/[^\r\n]/g, "") : line;
    if (end?.test(content)) end = null;
  }
  return result;
}

function rawVisibleHtml(value, rawHtml = false, blockBoundaries = false) {
  if (rawHtml) value = value.replace(/<\/?[a-z][a-z0-9-]*(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>/gi, tag => {
    if (/^<img\b/i.test(tag)) return tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(value => value !== undefined) || "";
    if (blockBoundaries && /^<\/?br(?:\s|\/?>)/i.test(tag)) return " ";
    if (blockBoundaries && /^<\/?(?:address|article|aside|blockquote|center|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|menu|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|br)(?:\s|\/?>)/i.test(tag)) return "\n\n";
    return /^<\/?(?:summary|details)\b/i.test(tag) ? " " : "";
  });
  return withoutHtmlComments(value).replace(/<(?:\/[a-z][a-z0-9-]*\s*|[a-z][a-z0-9-]*(?:\s+[a-z_:][a-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?)>/gi, tag => {
    if (blockBoundaries && /^<\/?br(?:\s|\/?>)/i.test(tag)) return " ";
    if (blockBoundaries && /^<\/?(?:address|article|aside|blockquote|center|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|menu|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|br)(?:\s|\/?>)/i.test(tag)) return "\n\n";
    if (/^<\/?(?:summary|details)\b/i.test(tag)) return " ";
    if (/^<img\b/i.test(tag)) return tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(value => value !== undefined) || "";
    return "";
  });
}

function markdownEscapeAt(value, index) {
  const code = value.charCodeAt(index + 1);
  return value[index] === "\\" && ((code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126));
}

function inlineLinkEnd(value, start) {
  let index = start, depth = 0;
  const finish = end => /\n[ \t]*\n/.test(value.slice(start, end).replace(/\r\n?/g, "\n")) ? null : end;
  { const begin = index; while (/[ \t\r\n\f\v]/.test(value[index] || "") && index < value.length) index++; if ((value.slice(begin, index).match(/\r\n|[\r\n]/g) || []).length > 1) return null; }
  if (value[index] === "<") {
    index++;
    for (; index < value.length && value[index] !== ">"; index++) {
      if (markdownEscapeAt(value, index)) index++;
      else if (/[\r\n]/.test(value[index]) || value[index] === "<") return null;
    }
    if (value[index++] !== ">") return null;
  } else {
    for (; index < value.length; index++) {
      const char = value[index];
      if (markdownEscapeAt(value, index)) { index++; continue; }
      if (char === "<" || char === ">" || (char.charCodeAt(0) < 32 && !/[ \t\r\n\f\v]/.test(char)) || char.charCodeAt(0) === 127) return null;
      if (/[ \t\r\n\f\v]/.test(char) && !depth) break;
      if (char === "(" && ++depth > 32) return null;
      else if (char === ")") { if (!depth) return finish(index + 1); depth--; }
    }
    if (depth) return null;
  }
  const boundary = index;
  { const begin = index; while (/[ \t\r\n\f\v]/.test(value[index] || "") && index < value.length) index++; if ((value.slice(begin, index).match(/\r\n|[\r\n]/g) || []).length > 1) return null; }
  if (value[index] === ")") return finish(index + 1);
  if (index === boundary || !['"', "'", "("].includes(value[index])) return null;
  const closing = value[index] === "(" ? ")" : value[index];
  for (index++; index < value.length && value[index] !== closing; index++) if (markdownEscapeAt(value, index)) index++;
  if (value[index++] !== closing) return null;
  { const begin = index; while (/[ \t\r\n\f\v]/.test(value[index] || "") && index < value.length) index++; if ((value.slice(begin, index).match(/\r\n|[\r\n]/g) || []).length > 1) return null; }
  return value[index] === ")" ? finish(index + 1) : null;
}

function markdownLinkOpenerAllowed(value, index) {
  let preceding = index - 1;
  while (preceding >= 0 && value[preceding] === "\\") preceding--;
  return (index - preceding - 1) % 2 === 0;
}

function markdownLabelEnd(value, start) {
  let depth = 1;
  for (let index = start; index < value.length; index++) {
    if (markdownEscapeAt(value, index)) { index++; continue; }
    if (value[index] === "[") depth++;
    else if (value[index] === "]" && --depth === 0) return index;
    else if (/[\r\n]/.test(value[index]) && /^\n[ \t]*\n/.test(value.slice(index).replace(/\r\n?/g, "\n"))) return null;
  }
  return null;
}

function containsActiveMarkdownLink(value, defined) {
  const starts = /!?\[/g;
  for (let match; (match = starts.exec(value));) {
    if (match[0][0] === "!" || !markdownLinkOpenerAllowed(value, match.index)) continue;
    const end = markdownLabelEnd(value, starts.lastIndex);
    if (end === null) continue;
    const label = value.slice(starts.lastIndex, end);
    if (value[end + 1] === "(" && inlineLinkEnd(value, end + 2) !== null) return true;
    if (value[end + 1] === "[") {
      const referenceEnd = markdownLabelEnd(value, end + 2);
      if (referenceEnd !== null && defined(value.slice(end + 2, referenceEnd) || label)) return true;
    } else if (value[end + 1] !== "(" && defined(label)) return true;
  }
  return false;
}

// Unicode 16 full case-fold exceptions to per-code-point lowercase; reference keys only.
const REFERENCE_CASE_FOLD = {"\u00b5":"\u03bc","\u00df":"ss","\u0149":"\u02bcn","\u017f":"s","\u01f0":"j\u030c","\u0345":"\u03b9","\u0390":"\u03b9\u0308\u0301","\u03b0":"\u03c5\u0308\u0301","\u03c2":"\u03c3","\u03d0":"\u03b2","\u03d1":"\u03b8","\u03d5":"\u03c6","\u03d6":"\u03c0","\u03f0":"\u03ba","\u03f1":"\u03c1","\u03f5":"\u03b5","\u0587":"\u0565\u0582","\u13a0":"\u13a0","\u13a1":"\u13a1","\u13a2":"\u13a2","\u13a3":"\u13a3","\u13a4":"\u13a4","\u13a5":"\u13a5","\u13a6":"\u13a6","\u13a7":"\u13a7","\u13a8":"\u13a8","\u13a9":"\u13a9","\u13aa":"\u13aa","\u13ab":"\u13ab","\u13ac":"\u13ac","\u13ad":"\u13ad","\u13ae":"\u13ae","\u13af":"\u13af","\u13b0":"\u13b0","\u13b1":"\u13b1","\u13b2":"\u13b2","\u13b3":"\u13b3","\u13b4":"\u13b4","\u13b5":"\u13b5","\u13b6":"\u13b6","\u13b7":"\u13b7","\u13b8":"\u13b8","\u13b9":"\u13b9","\u13ba":"\u13ba","\u13bb":"\u13bb","\u13bc":"\u13bc","\u13bd":"\u13bd","\u13be":"\u13be","\u13bf":"\u13bf","\u13c0":"\u13c0","\u13c1":"\u13c1","\u13c2":"\u13c2","\u13c3":"\u13c3","\u13c4":"\u13c4","\u13c5":"\u13c5","\u13c6":"\u13c6","\u13c7":"\u13c7","\u13c8":"\u13c8","\u13c9":"\u13c9","\u13ca":"\u13ca","\u13cb":"\u13cb","\u13cc":"\u13cc","\u13cd":"\u13cd","\u13ce":"\u13ce","\u13cf":"\u13cf","\u13d0":"\u13d0","\u13d1":"\u13d1","\u13d2":"\u13d2","\u13d3":"\u13d3","\u13d4":"\u13d4","\u13d5":"\u13d5","\u13d6":"\u13d6","\u13d7":"\u13d7","\u13d8":"\u13d8","\u13d9":"\u13d9","\u13da":"\u13da","\u13db":"\u13db","\u13dc":"\u13dc","\u13dd":"\u13dd","\u13de":"\u13de","\u13df":"\u13df","\u13e0":"\u13e0","\u13e1":"\u13e1","\u13e2":"\u13e2","\u13e3":"\u13e3","\u13e4":"\u13e4","\u13e5":"\u13e5","\u13e6":"\u13e6","\u13e7":"\u13e7","\u13e8":"\u13e8","\u13e9":"\u13e9","\u13ea":"\u13ea","\u13eb":"\u13eb","\u13ec":"\u13ec","\u13ed":"\u13ed","\u13ee":"\u13ee","\u13ef":"\u13ef","\u13f0":"\u13f0","\u13f1":"\u13f1","\u13f2":"\u13f2","\u13f3":"\u13f3","\u13f4":"\u13f4","\u13f5":"\u13f5","\u13f8":"\u13f0","\u13f9":"\u13f1","\u13fa":"\u13f2","\u13fb":"\u13f3","\u13fc":"\u13f4","\u13fd":"\u13f5","\u1c80":"\u0432","\u1c81":"\u0434","\u1c82":"\u043e","\u1c83":"\u0441","\u1c84":"\u0442","\u1c85":"\u0442","\u1c86":"\u044a","\u1c87":"\u0463","\u1c88":"\ua64b","\u1e96":"h\u0331","\u1e97":"t\u0308","\u1e98":"w\u030a","\u1e99":"y\u030a","\u1e9a":"a\u02be","\u1e9b":"\u1e61","\u1e9e":"ss","\u1f50":"\u03c5\u0313","\u1f52":"\u03c5\u0313\u0300","\u1f54":"\u03c5\u0313\u0301","\u1f56":"\u03c5\u0313\u0342","\u1f80":"\u1f00\u03b9","\u1f81":"\u1f01\u03b9","\u1f82":"\u1f02\u03b9","\u1f83":"\u1f03\u03b9","\u1f84":"\u1f04\u03b9","\u1f85":"\u1f05\u03b9","\u1f86":"\u1f06\u03b9","\u1f87":"\u1f07\u03b9","\u1f88":"\u1f00\u03b9","\u1f89":"\u1f01\u03b9","\u1f8a":"\u1f02\u03b9","\u1f8b":"\u1f03\u03b9","\u1f8c":"\u1f04\u03b9","\u1f8d":"\u1f05\u03b9","\u1f8e":"\u1f06\u03b9","\u1f8f":"\u1f07\u03b9","\u1f90":"\u1f20\u03b9","\u1f91":"\u1f21\u03b9","\u1f92":"\u1f22\u03b9","\u1f93":"\u1f23\u03b9","\u1f94":"\u1f24\u03b9","\u1f95":"\u1f25\u03b9","\u1f96":"\u1f26\u03b9","\u1f97":"\u1f27\u03b9","\u1f98":"\u1f20\u03b9","\u1f99":"\u1f21\u03b9","\u1f9a":"\u1f22\u03b9","\u1f9b":"\u1f23\u03b9","\u1f9c":"\u1f24\u03b9","\u1f9d":"\u1f25\u03b9","\u1f9e":"\u1f26\u03b9","\u1f9f":"\u1f27\u03b9","\u1fa0":"\u1f60\u03b9","\u1fa1":"\u1f61\u03b9","\u1fa2":"\u1f62\u03b9","\u1fa3":"\u1f63\u03b9","\u1fa4":"\u1f64\u03b9","\u1fa5":"\u1f65\u03b9","\u1fa6":"\u1f66\u03b9","\u1fa7":"\u1f67\u03b9","\u1fa8":"\u1f60\u03b9","\u1fa9":"\u1f61\u03b9","\u1faa":"\u1f62\u03b9","\u1fab":"\u1f63\u03b9","\u1fac":"\u1f64\u03b9","\u1fad":"\u1f65\u03b9","\u1fae":"\u1f66\u03b9","\u1faf":"\u1f67\u03b9","\u1fb2":"\u1f70\u03b9","\u1fb3":"\u03b1\u03b9","\u1fb4":"\u03ac\u03b9","\u1fb6":"\u03b1\u0342","\u1fb7":"\u03b1\u0342\u03b9","\u1fbc":"\u03b1\u03b9","\u1fbe":"\u03b9","\u1fc2":"\u1f74\u03b9","\u1fc3":"\u03b7\u03b9","\u1fc4":"\u03ae\u03b9","\u1fc6":"\u03b7\u0342","\u1fc7":"\u03b7\u0342\u03b9","\u1fcc":"\u03b7\u03b9","\u1fd2":"\u03b9\u0308\u0300","\u1fd3":"\u03b9\u0308\u0301","\u1fd6":"\u03b9\u0342","\u1fd7":"\u03b9\u0308\u0342","\u1fe2":"\u03c5\u0308\u0300","\u1fe3":"\u03c5\u0308\u0301","\u1fe4":"\u03c1\u0313","\u1fe6":"\u03c5\u0342","\u1fe7":"\u03c5\u0308\u0342","\u1ff2":"\u1f7c\u03b9","\u1ff3":"\u03c9\u03b9","\u1ff4":"\u03ce\u03b9","\u1ff6":"\u03c9\u0342","\u1ff7":"\u03c9\u0342\u03b9","\u1ffc":"\u03c9\u03b9","\uab70":"\u13a0","\uab71":"\u13a1","\uab72":"\u13a2","\uab73":"\u13a3","\uab74":"\u13a4","\uab75":"\u13a5","\uab76":"\u13a6","\uab77":"\u13a7","\uab78":"\u13a8","\uab79":"\u13a9","\uab7a":"\u13aa","\uab7b":"\u13ab","\uab7c":"\u13ac","\uab7d":"\u13ad","\uab7e":"\u13ae","\uab7f":"\u13af","\uab80":"\u13b0","\uab81":"\u13b1","\uab82":"\u13b2","\uab83":"\u13b3","\uab84":"\u13b4","\uab85":"\u13b5","\uab86":"\u13b6","\uab87":"\u13b7","\uab88":"\u13b8","\uab89":"\u13b9","\uab8a":"\u13ba","\uab8b":"\u13bb","\uab8c":"\u13bc","\uab8d":"\u13bd","\uab8e":"\u13be","\uab8f":"\u13bf","\uab90":"\u13c0","\uab91":"\u13c1","\uab92":"\u13c2","\uab93":"\u13c3","\uab94":"\u13c4","\uab95":"\u13c5","\uab96":"\u13c6","\uab97":"\u13c7","\uab98":"\u13c8","\uab99":"\u13c9","\uab9a":"\u13ca","\uab9b":"\u13cb","\uab9c":"\u13cc","\uab9d":"\u13cd","\uab9e":"\u13ce","\uab9f":"\u13cf","\uaba0":"\u13d0","\uaba1":"\u13d1","\uaba2":"\u13d2","\uaba3":"\u13d3","\uaba4":"\u13d4","\uaba5":"\u13d5","\uaba6":"\u13d6","\uaba7":"\u13d7","\uaba8":"\u13d8","\uaba9":"\u13d9","\uabaa":"\u13da","\uabab":"\u13db","\uabac":"\u13dc","\uabad":"\u13dd","\uabae":"\u13de","\uabaf":"\u13df","\uabb0":"\u13e0","\uabb1":"\u13e1","\uabb2":"\u13e2","\uabb3":"\u13e3","\uabb4":"\u13e4","\uabb5":"\u13e5","\uabb6":"\u13e6","\uabb7":"\u13e7","\uabb8":"\u13e8","\uabb9":"\u13e9","\uabba":"\u13ea","\uabbb":"\u13eb","\uabbc":"\u13ec","\uabbd":"\u13ed","\uabbe":"\u13ee","\uabbf":"\u13ef","\ufb00":"ff","\ufb01":"fi","\ufb02":"fl","\ufb03":"ffi","\ufb04":"ffl","\ufb05":"st","\ufb06":"st","\ufb13":"\u0574\u0576","\ufb14":"\u0574\u0565","\ufb15":"\u0574\u056b","\ufb16":"\u057e\u0576","\ufb17":"\u0574\u056d"};
function referenceCaseFold(label) {
  return Array.from(label, character => REFERENCE_CASE_FOLD[character] ?? character.toLowerCase()).join("");
}

function validMarkdownReferenceLabel(label) {
  return !(label.startsWith("^") && /^[^\[\]\x00-\x20]+$/.test(label.slice(1))) && label.length >= 1 && label.length <= 999 && /[^ \t\r\n\f\v]/.test(label) &&
    ![...label.matchAll(/[\[\]]/g)].some(bracket => markdownLinkOpenerAllowed(label, bracket.index));
}

function markdownReferenceDefinitions(value, hiddenLines = null) {
  const definitions = new Set();
  const lines = value.split(/\r\n|[\r\n]/);
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^ {0,3}\[((?:\\[\s\S]|[^\]\\\n])+)\]:([\s\S]*)$/);
    if (!match || !validMarkdownReferenceLabel(match[1])) continue;
    const candidates = [match[2]];
    for (let extra = 1; extra <= 2 && index + extra < lines.length; extra++) {
      if (!/^ {0,3}[^ \t\r\n\f\v]/.test(lines[index + extra])) break;
      candidates.push(match[2] + "\n" + lines.slice(index + 1, index + extra + 1).join("\n"));
    }
    const valid = candidates.reverse().find(candidate => /[^ \t\r\n\f\v]/.test(candidate) && inlineLinkEnd(candidate + ")", 0) === candidate.length + 1);
    if (valid !== undefined) {
      definitions.add(referenceCaseFold(match[1].trim().replace(/\s+/g, " ")));
      if (hiddenLines) for (let line = index; line <= index + valid.split("\n").length - 1; line++) hiddenLines.add(line);
    }
  }
  return definitions;
}

function visibleMarkdownLinkLabels(value, referenceText = value) {
  const definitions = markdownReferenceDefinitions(referenceText);
  const hiddenLines = new Set(); markdownReferenceDefinitions(value, hiddenLines);
  value = value.split(/\r\n|[\r\n]/).map((line, index) => hiddenLines.has(index) ? "" : line).join("\n");
  const defined = label => definitions.has(referenceCaseFold(label.trim().replace(/\s+/g, " ")));
  let output = "", cursor = 0;
  const starts = /!?\[/g;
  for (let match; (match = starts.exec(value));) {
    if (!markdownLinkOpenerAllowed(value, match.index)) continue;
    const labelEnd = markdownLabelEnd(value, starts.lastIndex);
    if (labelEnd === null) continue;
    const label = value.slice(starts.lastIndex, labelEnd);
    if (containsActiveMarkdownLink(label, defined)) continue;
    let end = null;
    if (value[labelEnd + 1] === "(") end = inlineLinkEnd(value, labelEnd + 2);
    else if (value[labelEnd + 1] === "[") {
      const referenceEnd = markdownLabelEnd(value, labelEnd + 2);
      if (referenceEnd !== null && defined(value.slice(labelEnd + 2, referenceEnd) || label)) end = referenceEnd + 1;
    } else if (defined(label)) end = labelEnd + 1;
    if (end === null) continue;
    output += value.slice(cursor, match.index) + label;
    cursor = end; starts.lastIndex = end;
  }
  return output + value.slice(cursor);
}

function indentationColumns(prefix) {
  return Array.from(prefix).reduce((column, character) => column + (character === "\t" ? 4 - column % 4 : 1), 0);
}

function consumeIndentationColumns(line, required) {
  let column = 0, index = 0;
  while (column < required && /[ \t]/.test(line[index] || "x")) {
    column += line[index++] === "\t" ? 4 - column % 4 : 1;
  }
  return column < required ? null : " ".repeat(column - required) + line.slice(index);
}

// HTML tokenizer comment endings, including abrupt empty-comment closure.
function htmlCommentEnd(source, start) {
  if (source.startsWith("<!-->", start)) return start + 5;
  if (source.startsWith("<!--->", start)) return start + 6;
  const close = /--!?>/g;
  close.lastIndex = start + 4;
  const match = close.exec(source);
  return match ? match.index + match[0].length : null;
}

function withoutHtmlComments(source) {
  let result = "", cursor = 0, start;
  while ((start = source.indexOf("<!--", cursor)) >= 0) {
    const end = htmlCommentEnd(source, start) ?? source.length;
    result += source.slice(cursor, start) + source.slice(start, end).replace(/[^\r\n]/g, "");
    cursor = end;
  }
  return result + source.slice(cursor);
}

function markdownContainerContext(line) {
  const frames = [];
  while (true) {
    const quote = line.match(/^ {0,3}>[ \t]?/);
    if (quote) { frames.push({ kind: "quote" }); line = line.slice(quote[0].length); continue; }
    const list = line.match(/^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])[ \t]+/);
    if (list) { frames.push({ kind: "list", width: indentationColumns(list[0]) }); line = line.slice(list[0].length); continue; }
    return { content: line, frames };
  }
}

function markdownContainerContinuation(line, frames) {
  for (const frame of frames) {
    if (frame.kind === "list") {
      line = consumeIndentationColumns(line, frame.width);
      if (line === null) return null;
    } else {
      const prefix = line.match(/^ {0,3}>[ \t]?/);
      if (!prefix) return null;
      line = line.slice(prefix[0].length);
    }
  }
  return line;
}

function markdownContainerContent(line) {
  return markdownContainerContext(line).content;
}

function projectFootnoteDefinitions(value, ranges, inlineDelimiters, htmlStarts) {
  const definitions = [...value.matchAll(/^ {0,3}\[\^([^\[\]\x00-\x20]+)\]:[^\r\n]*(?:(?:\r\n|\r|\n)(?: {2,}|\t)[^\r\n]*)*/gm)]
    .filter(match => !ranges.some(([start, end]) => match.index >= start && match.index < end));
  const key = referenceCaseFold;
  const refs = text => {
    const rendered = visibleMarkdownLinkLabels(rawVisibleHtml(text), activeText);
    return [...rendered.matchAll(/\[\^([^\[\]\x00-\x20]+)\]/g)].filter(match => markdownLinkOpenerAllowed(rendered, match.index)).map(match => key(match[1]));
  };
  for (let i = ranges.length - 1; i >= 0; i--) {
    const [start, end] = ranges[i];
    if (!inlineDelimiters.has(start) && !htmlStarts.has(start) && definitions.some(match => start >= match.index && (end <= match.index + match[0].length || /^[\r\n]*$/.test(value.slice(match.index + match[0].length, end))))) ranges.splice(i, 1);
  }
  let usage = value;
  for (const [start, end] of [...ranges].sort((a,b) => b[0]-a[0])) usage = usage.slice(0,start) + usage.slice(start,end).replace(/[^\r\n]/g," ") + usage.slice(end);
  const activeText = usage;
  for (const match of [...definitions].reverse()) usage = usage.slice(0,match.index) + match[0].replace(/[^\r\n]/g," ") + usage.slice(match.index+match[0].length);
  const used = new Set(refs(usage));
  for (const label of used) {
    const definition = definitions.find(match => key(match[1]) === label);
    if (definition) for (const ref of refs(activeText.slice(definition.index, definition.index + definition[0].length).replace(/^ {0,3}\[\^[^\]\r\n]+\]:/,""))) used.add(ref);
  }
  for (const match of [...definitions].reverse()) {
    const replacement = used.has(key(match[1])) ? match[0].replace(/^ {0,3}\[\^[^\]\r\n]+\]:/, prefix => " ".repeat(prefix.length)) : match[0].replace(/[^\r\n]/g," ");
    value = value.slice(0,match.index) + replacement + value.slice(match.index+match[0].length);
  }
  return value;
}

function literalAwareVisibleText(value, structuralOnly = false) {
  value = String(value || "");
  const comments = [];
  for (let start = value.indexOf("<!--"); start >= 0;) {
    const end = htmlCommentEnd(value, start) ?? value.length;
    comments.push([start, end]); start = value.indexOf("<!--", end);
  }
  const inComment = index => comments.some(([start, end]) => index >= start && index < end);
  const htmlRanges = [];
  withoutAuthorityHtmlBlocks(value, htmlRanges);
  const rawBlockRanges = htmlRanges.map(range => [...range]);
  for (const match of value.matchAll(/<(pre|code|script|style|textarea)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)/gi)) if (!inComment(match.index)) htmlRanges.push([match.index, match.index + match[0].length]);
  const mergedHtml = [];
  for (const range of htmlRanges.sort((a, b) => a[0] - b[0])) {
    const prior = mergedHtml.at(-1);
    if (prior && range[0] <= prior[1]) prior[1] = Math.max(prior[1], range[1]);
    else mergedHtml.push([...range]);
  }
  const htmlStarts = new Set(mergedHtml.map(range => range[0]));
  const ranges = mergedHtml.map(range => [...range]);
  let offset = 0, fence = null, fenceStart = 0;
  for (const line of value.split(/(?<=\n)/)) {
    const content = markdownContainerContent(line);
    const marker = content.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*$/.test(content.slice(marker[0].length))) { ranges.push([fenceStart, offset + line.length]); fence = null; }
    } else if (marker && !inComment(offset)) { fence = marker[1]; fenceStart = offset; }
    else if (/^(?: {4}| *\t)/.test(content) && !inComment(offset)) ranges.push([offset, offset + line.length]);
    offset += line.length;
  }
  if (fence) ranges.push([fenceStart, value.length]);
  const inlineDelimiters = new Map();
  const ticks = /`+/g;
  for (let opening; (opening = ticks.exec(value));) {
    if (!markdownLinkOpenerAllowed(value, opening.index) || inComment(opening.index) || ranges.some(([start, end]) => opening.index >= start && opening.index < end)) continue;
    const closing = new RegExp("(?<!`)" + opening[0] + "(?!`)", "g"); closing.lastIndex = ticks.lastIndex;
    const match = closing.exec(value);
    if (match) { inlineDelimiters.set(opening.index, opening[0].length); ranges.push([opening.index, match.index + match[0].length]); ticks.lastIndex = match.index + match[0].length; }
  }
  if (structuralOnly) {
    for (const [start, end] of [...comments, ...ranges.filter(([start]) => !htmlStarts.has(start))].sort((a, b) => b[0] - a[0])) value = value.slice(0, start) + value.slice(start, end).replace(/[^\r\n]/g, " ") + value.slice(end);
    return value;
  }
  value = projectFootnoteDefinitions(value, ranges, inlineDelimiters, htmlStarts);
  ranges.sort((a, b) => a[0] - b[0]);
  let referenceText = value;
  for (const [start, end] of [...ranges].reverse()) referenceText = referenceText.slice(0, start) + referenceText.slice(start, end).replace(/[^\r\n]/g, " ") + referenceText.slice(end);
  let result = "", cursor = 0;
  for (const [start, end] of ranges) {
    if (end <= cursor) continue;
    if (start > cursor) result += normalizeVisibleFragment(visibleMarkdownLinkLabels(rawVisibleHtml(value.slice(cursor, start), false, true), referenceText));
    const delimiter = inlineDelimiters.get(start) || 0;
    const content = value.slice(Math.max(cursor, start + delimiter), end - delimiter);
    result += htmlStarts.has(start) ? normalizeVisibleFragment(rawVisibleHtml(content, rawBlockRanges.some(([begin, finish]) => start >= begin && start < finish), true), rawBlockRanges.some(([begin, finish]) => start >= begin && start < finish)) : content; cursor = end;
  }
  return result + normalizeVisibleFragment(visibleMarkdownLinkLabels(rawVisibleHtml(value.slice(cursor), false, true), referenceText));
}

function renderedLabelAmbiguityText(value) {
  return normalizeVisibleFragment(rawVisibleHtml(visibleMarkdownLinkLabels(String(value || ""))));
}

function hasPositiveFindingStatement(text) {
  const cardinal = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?)";
  const paragraphs = String(text).replace(/\r\n/g, "\n").split(/[\r\n][ \t\f\v]*[\r\n]/);
  return paragraphs.some((paragraph) => paragraph.replace(/[ \t\r\n\f\v]+/g, " ")
    .replace(new RegExp("\\b(?:no|zero) +(?:issues?|findings?|problems?|bugs?|flaws?|defects?|regressions?|vulnerabilit(?:y|ies)|security +risks?)[^.!?;]*?\\bexcept +((?:[1-9][0-9]*|some|several|multiple|" + cardinal + "))\\b([^.!?;]*)", "giu"), (match, count, suffix) => match + "; " + count + " findings" + (suffix.trim() ? suffix.replace(/^ *, */, " ") : " remain"))
    .replace(/\b(no|zero) +((?:issues?|findings?|problems?|bugs?|flaws?|defects?|regressions?|vulnerabilit(?:y|ies)|security +risks?)) +(?:and|or) +(?:issues?|findings?|problems?|bugs?|flaws?|defects?|regressions?|vulnerabilit(?:y|ies)|security +risks?)\b/giu, "$1 $2")
    .replace(/\b(no|zero) +(?:(?!(?:issues?|findings?|problems?|bugs?|flaws?|defects?|regressions?|vulnerabilit(?:y|ies)|security +risks?|is|are|was|were|has|have|been|get|gets|got|a|an|one|some|several|multiple)\b)[\p{L}-]+ +)+(?:and|or) +(?:(?!(?:issues?|findings?|problems?|bugs?|flaws?|defects?|regressions?|vulnerabilit(?:y|ies)|security +risks?|is|are|was|were|has|have|been|get|gets|got|a|an|one|some|several|multiple)\b)[\p{L}-]+ +)*((?:issues?|findings?|problems?|bugs?|flaws?|defects?|regressions?|vulnerabilit(?:y|ies)|security +risks?)\b)/giu, "$1 $2")
    .split(/[.!?;]|(?<![0-9]),|,(?![0-9])|\b(?:and|or|but|however|yet)\b/i).some((clause) => {
      // Negating a resolution preserves the finding, unlike negating its noun.
      clause = clause.replace(/\b(?:not|never) +(?:(?:be|been|being|get|gets|got|gotten|getting) +)*(?:resolved|fixed|addressed|cleared|removed|closed|eliminated)\b|\b(?:is|are|was|were|has|have|had)n['’]t +(?:(?:be|been|being|get|gets|got|gotten|getting) +)*(?:resolved|fixed|addressed|cleared|removed|closed|eliminated)\b/gi, " unresolved ");
      const noun = "(?<![\\p{L}\\p{N}_\\p{Pd}])(?:issues?|findings?|problems?|bugs?|flaws?|defects?|regressions?|vulnerabilit(?:y|ies)|security +risks?)(?![\\p{L}\\p{N}_\\p{Pd}])(?! +(?:tests?|reports?)\\b)";
      const headingNoun = noun.replace("(?![\\p{L}\\p{N}_\\p{Pd}])", "(?![\\p{L}\\p{N}_-])");
      const isAffirmative = (match, counted = false) => {
        const before = clause.slice(0, match.index);
        const after = clause.slice(match.index + match[0].length);
        if (!counted && /^ *(?::|[–—-]) *(?:no|none|zero|0+(?:,000)*)(?: +(?:(?:is|are|was|were|be|been|being|has|have|had|[\p{L}]+ly|now) +)*(?:found|outstanding|exist|exists|remain|remains))? *$/iu.test(after)) return false;
        // Scope negation to this construction, not an unrelated earlier clause.
        if (/\b(?:no|zero|not|without|never|cannot)\b|\b[\p{L}]+n['’]t\b/iu.test(match[0])) return false;
        if (/(?:\b(?:no|zero|not|without|never|cannot)|\b[\p{L}]+n['’]t)(?: +(?:be|been|being|get|gets|got|gotten|getting|considered))* +$/iu.test(before)) return false;
        if (/^\s*(?:nobody|none|neither +[\p{L}-]+) +(?:(?:can|could|may|might) +(?:[\p{L}]+ly +)*|(?:is|are) +(?:able|possible) +to +)bypass +authentication\b/iu.test(match[0])) return false;
        if (/\bnone +of +(?:the +)?$/iu.test(before)) return false;
        if (/ +(?:is|are|was|were|has|have|had|be|been|being|get|gets|got|gotten|getting) *$/iu.test(match[0]) && /^ +(?:not|never)\b/iu.test(after)) return false;
        const matchedNoun = [...match[0].matchAll(new RegExp(noun, "giu"))].at(-1);
        const predicate = matchedNoun ? match[0].slice(matchedNoun.index + matchedNoun[0].length) : match[0];
        const modifiers = matchedNoun ? match[0].slice(0, matchedNoun.index) : "";
        const tail = predicate + after;
        // Absence/resolution is evidence only for an unqualified completed assertion.
        if (/^ +(?:do|does|did) +not +(?:exist|exists|remain|remains) *$/iu.test(tail)) return false;
        if (/\b(?:resolved|fixed|addressed|cleared|removed|closed|eliminated) +$/iu.test(before)) return false;
        const recurrence = /\b(?:reappears?|reappeared|recurs?|recurred|reopens?|reopened|found +again|unresolved|(?:is|are) +(?:still +)?(?:open|outstanding|unresolved)|(?:still +)?(?:persists?|remains?|exists?))\b/iu.test(tail) && !/\b(?:not|never) +(?:reappear|reappeared|recur|recurred|reopen|reopened|persist|remain|exist)\b/iu.test(tail);
        // Remediation compounds stay neutral unless their own state is reaffirmed.
        if (/^ +fix(?:es)?\b/iu.test(tail) && !recurrence) return false;
        // A mention is informational only when its own finding is not reaffirmed.
        if (/\b(?:mention(?:s|ed|ing)?|discuss(?:es|ed|ing)?) +(?:a|an|one|some|several|multiple|the) +/iu.test(modifiers) && !recurrence) return false;
        if (/\b(?:resolves?|fix(?:es)?|address(?:es)?|clears?|removes?|closes?|eliminates?|prevents?|avoids?|mitigates?) +(?:a|an) +/iu.test(modifiers) && !recurrence && !tail.trim()) return false;
        const obligation = /\b(?:can|could|may|might|will|would|must|should) +(?:(?:be|been|being|get|gets|got) +)*(?:resolved|fixed|addressed|cleared|removed|closed|eliminated)\b/iu.test(tail);
        if (obligation) return true;
        if (/\b(?:resolved|fixed|addressed|cleared|removed|closed|eliminated)\b/i.test(modifiers) && !recurrence && !/^ +(?:(?:is|are|was|were|has|have|had|be|been|being|get|gets|got|gotten|getting) +)*(?:can|could|may|might|will|would|must|should) +(?:reappear|recur|reopen)\b/iu.test(tail)) return false;
        if (/^(?: +| *(?::|[–—-]) *)(?:(?:that|which) +)?(?:(?:is|are|was|were|has|have|had|be|been|being|get|gets|got|gotten|getting|now|already|remains?) +)*(?:resolved|fixed|addressed|cleared|removed|closed|eliminated|harmless|benign) *$/iu.test(tail)) return false;
          return true;
      };
      const counts = [...clause.matchAll(new RegExp("(?<![\\p{L}\\p{N}_])[*_~`]*([0-9]+(?:,[0-9]{3})*)[*_~`]* +(?:[\\p{L}-]+ +)*?" + noun, "giu"))];
      if (counts.some((match) => !/^0+$/.test(match[1].replaceAll(",", "")) && isAffirmative(match, true))) return true;
      const reporting = clause.replace(new RegExp("(?<![\\p{L}\\p{N}_])[*_~`]*0+(?:,000)*[*_~`]* +(?:[\\p{L}-]+ +)*?" + noun, "giu"), (match) => " ".repeat(match.length));
      const cardinalPattern = "\\b" + cardinal + " +(?:[\\p{L}-]+ +)*?" + noun;
      if ([...reporting.matchAll(new RegExp(cardinalPattern, "giu"))].some((match) => isAffirmative(match, true))) return true;
      const patterns = [
        "\\b(?:is|are) +vulnerable +to\\b",
        "\\bauthentication +(?:can|could|may|might) +be +bypassed\\b",
        "\\b(?:(?:(?:no|neither) +(?:(?!(?:is|are|was|were|has|have|had|can|could|may|might)\\b)[\\p{L}-]+ +)*?)?[\\p{L}-]+ +)?(?:(?:can|could|may|might) +(?:[\\p{L}]+ly +)*|(?:is|are) +(?:able|possible) +to +)bypass +authentication\\b",
        "\\b(?:most|every|numerous) +(?:[\\p{L}-]+ +)*?" + noun + " +(?:(?:is|are|was|were|has|have|had|be|been|being|get|gets|got|gotten|getting|still) +)*(?:found|[\\p{L}]+ed|remains?|exists?)\\b",
          "(?<![\\p{L}\\p{N}_] )\\b(?:the +)?(?:(?:critical|security|authentication|code|blocking|high|medium|low|major|minor|unresolved|open|new) +)+" + noun + " +(?:(?:is|are|was|were|has|have|had|be|been|being|get|gets|got|gotten|getting|still) +)*(?:(?:is|are|was|were) +[\\p{L}]+|found|[\\p{L}]+ed|[\\p{L}]+s|remains?|exists?)\\b",
        "\\b(?:a|an) +(?:[\\p{L}-]+ +)*?" + noun + " +(?:(?:can|could|may|might|will|would|must|should) +[\\p{L}-]+|[\\p{L}]+s)\\b",
        "\\bthe +" + noun + " +(?:(?:is|are|was|were) +[\\p{L}-]+|(?:can|could|may|might|will|would|must|should) +[\\p{L}-]+|[\\p{L}]+s)\\b",
        "\\b(?:this|that|these|those) +(?:(?:code|security|blocking|critical|high|medium|low|major|minor|unresolved|open|new|resolved|fixed|addressed|cleared|removed|closed|eliminated) +)*" + noun + " +(?:(?:is|are|was|were) +[\\p{L}-]+|[\\p{L}]+s)\\b",
        "\\b(?:this|that|these|those) +(?:is|are|was|were) +(?:a|an) +(?:[\\p{L}-]+ +)*?" + noun,
        "(?<![\\p{L}\\p{N}_] )\\b(?:(?:a|an|one|some|several|multiple) +)?(?:(?!(?:the|this|that|these|those)\\b)[\\p{L}-]+ +)*?" + headingNoun + "(?= *(?::|[–—-]) *[^ \\t])",
        "\\b(?:found|introduces|creates|contains|has|[\\p{L}]+ed) +(?:[\\p{L}-]+ +)*?" + noun,
        "\\b[\\p{L}]+s +(?:a|an) +(?:[\\p{L}-]+ +)*?" + noun,
        "\\b(?:I|we) +[\\p{L}]+ +(?:a|an) +(?:[\\p{L}-]+ +)*?" + noun,
        "(?:\\b(?:a|an|one|some|several|multiple|[0-9]+) +(?:[\\p{L}-]+ +)*?" + noun + "|\\bthe +" + noun + "|(?<![\\p{L}\\p{N}_] )" + noun + ")" + " +(?:(?:is|are|was|were|has|have|had|be|been|being|get|gets|got|gotten|getting|still) +)*(?:found|[\\p{L}]+ed|remains?|exists?)\\b",
        "\\bthere +(?:still +)?(?:is|are) +(?:[\\p{L}-]+ +)*?" + noun,
        "\\b(?:a|an) +(?:[\\p{L}-]+ +)*?" + noun + " +(?:(?:is|are|was|were) +[\\p{L}-]+|(?!(?:is|was|has)\\b)[\\p{L}]+s)\\b",
        "\\b(?:this|that|these|those) +" + noun + " +(?:(?:is|are|was|were) +[\\p{L}-]+|(?!(?:is|was|has)\\b)[\\p{L}]+s)\\b",
        "(?:\\b(?:both|many|all) +|(?<![\\p{L}\\p{N}_] ))(?:issues|findings|problems|bugs|flaws|defects|regressions|vulnerabilities|security +risks)\\b +(?:(?:is|are|was|were) +[\\p{L}-]+|(?!(?:is|was|has)\\b)[\\p{L}]+)\\b"
      ];
      return patterns.some((pattern) => [...reporting.matchAll(new RegExp(pattern, "giu"))].some((match) => isAffirmative(match)));
    }));
}



function visibleReviewText(value) {
  return literalAwareVisibleText(value);
}

// HTML5 legacy named references: Python html.entities.html5 keys without semicolons.
const LEGACY_HTML_NAMES = Object.freeze({
  "Aacute": "\u00c1", "aacute": "\u00e1", "Acirc": "\u00c2", "acirc": "\u00e2", "acute": "\u00b4", "AElig": "\u00c6", "aelig": "\u00e6", "Agrave": "\u00c0",
  "agrave": "\u00e0", "AMP": "&", "amp": "&", "Aring": "\u00c5", "aring": "\u00e5", "Atilde": "\u00c3", "atilde": "\u00e3", "Auml": "\u00c4",
  "auml": "\u00e4", "brvbar": "\u00a6", "Ccedil": "\u00c7", "ccedil": "\u00e7", "cedil": "\u00b8", "cent": "\u00a2", "COPY": "\u00a9", "copy": "\u00a9",
  "curren": "\u00a4", "deg": "\u00b0", "divide": "\u00f7", "Eacute": "\u00c9", "eacute": "\u00e9", "Ecirc": "\u00ca", "ecirc": "\u00ea", "Egrave": "\u00c8",
  "egrave": "\u00e8", "ETH": "\u00d0", "eth": "\u00f0", "Euml": "\u00cb", "euml": "\u00eb", "frac12": "\u00bd", "frac14": "\u00bc", "frac34": "\u00be",
  "GT": ">", "gt": ">", "Iacute": "\u00cd", "iacute": "\u00ed", "Icirc": "\u00ce", "icirc": "\u00ee", "iexcl": "\u00a1", "Igrave": "\u00cc",
  "igrave": "\u00ec", "iquest": "\u00bf", "Iuml": "\u00cf", "iuml": "\u00ef", "laquo": "\u00ab", "LT": "<", "lt": "<", "macr": "\u00af",
  "micro": "\u00b5", "middot": "\u00b7", "nbsp": "\u00a0", "not": "\u00ac", "Ntilde": "\u00d1", "ntilde": "\u00f1", "Oacute": "\u00d3", "oacute": "\u00f3",
  "Ocirc": "\u00d4", "ocirc": "\u00f4", "Ograve": "\u00d2", "ograve": "\u00f2", "ordf": "\u00aa", "ordm": "\u00ba", "Oslash": "\u00d8", "oslash": "\u00f8",
  "Otilde": "\u00d5", "otilde": "\u00f5", "Ouml": "\u00d6", "ouml": "\u00f6", "para": "\u00b6", "plusmn": "\u00b1", "pound": "\u00a3", "QUOT": "\"",
  "quot": "\"", "raquo": "\u00bb", "REG": "\u00ae", "reg": "\u00ae", "sect": "\u00a7", "shy": "\u00ad", "sup1": "\u00b9", "sup2": "\u00b2",
  "sup3": "\u00b3", "szlig": "\u00df", "THORN": "\u00de", "thorn": "\u00fe", "times": "\u00d7", "Uacute": "\u00da", "uacute": "\u00fa", "Ucirc": "\u00db",
  "ucirc": "\u00fb", "Ugrave": "\u00d9", "ugrave": "\u00f9", "uml": "\u00a8", "Uuml": "\u00dc", "uuml": "\u00fc", "Yacute": "\u00dd", "yacute": "\u00fd",
  "yen": "\u00a5", "yuml": "\u00ff",
});
// Valid semicolon-terminated HTML5 names take precedence over legacy prefixes.
const HTML_ENTITY_NAMES = new Set([
  "AElig|AMP|Aacute|Abreve|Acirc|Acy|Afr|Agrave|Alpha|Amacr|And|Aogon|Aopf|ApplyFunction|Aring|Ascr|Assign|Atilde|Auml|Backslash|Barv|Barwed|Bcy|Because|Bernoullis|Beta|Bfr|Bopf|Breve|Bscr|Bumpeq|CHcy|COPY|Cacute|Cap|CapitalDifferentialD|Cayleys|Ccaron|Ccedil|Ccirc|Cconint|Cdot|Cedilla|CenterDot|Cfr|Chi|CircleDot|CircleMinus|CirclePlus|CircleTimes|ClockwiseContourIntegral|CloseCurlyDoubleQuote|CloseCurlyQuote|Colon|Colone|Congruent|Conint|ContourIntegral|Copf|Coproduct|CounterClockwiseContourIntegral|Cross|Cscr|Cup|CupCap|DD|DDotrahd|DJcy|DScy|DZcy|Dagger|Darr|Dashv|Dcaron|Dcy|Del|Delta|Dfr|DiacriticalAcute|DiacriticalDot",
  "DiacriticalDoubleAcute|DiacriticalGrave|DiacriticalTilde|Diamond|DifferentialD|Dopf|Dot|DotDot|DotEqual|DoubleContourIntegral|DoubleDot|DoubleDownArrow|DoubleLeftArrow|DoubleLeftRightArrow|DoubleLeftTee|DoubleLongLeftArrow|DoubleLongLeftRightArrow|DoubleLongRightArrow|DoubleRightArrow|DoubleRightTee|DoubleUpArrow|DoubleUpDownArrow|DoubleVerticalBar|DownArrow|DownArrowBar|DownArrowUpArrow|DownBreve|DownLeftRightVector|DownLeftTeeVector|DownLeftVector|DownLeftVectorBar|DownRightTeeVector|DownRightVector|DownRightVectorBar|DownTee|DownTeeArrow|Downarrow|Dscr|Dstrok|ENG|ETH|Eacute|Ecaron|Ecirc|Ecy|Edot|Efr|Egrave|Element|Emacr|EmptySmallSquare|EmptyVerySmallSquare|Eogon|Eopf|Epsilon|Equal|EqualTilde|Equilibrium|Escr|Esim|Eta|Euml|Exists|ExponentialE|Fcy|Ffr|FilledSmallSquare|FilledVerySmallSquare|Fopf|ForAll|Fouriertrf|Fscr|GJcy|GT|Gamma|Gammad|Gbreve|Gcedil|Gcirc|Gcy",
  "Gdot|Gfr|Gg|Gopf|GreaterEqual|GreaterEqualLess|GreaterFullEqual|GreaterGreater|GreaterLess|GreaterSlantEqual|GreaterTilde|Gscr|Gt|HARDcy|Hacek|Hat|Hcirc|Hfr|HilbertSpace|Hopf|HorizontalLine|Hscr|Hstrok|HumpDownHump|HumpEqual|IEcy|IJlig|IOcy|Iacute|Icirc|Icy|Idot|Ifr|Igrave|Im|Imacr|ImaginaryI|Implies|Int|Integral|Intersection|InvisibleComma|InvisibleTimes|Iogon|Iopf|Iota|Iscr|Itilde|Iukcy|Iuml|Jcirc|Jcy|Jfr|Jopf|Jscr|Jsercy|Jukcy|KHcy|KJcy|Kappa|Kcedil|Kcy|Kfr|Kopf|Kscr|LJcy|LT|Lacute|Lambda|Lang|Laplacetrf|Larr|Lcaron|Lcedil|Lcy|LeftAngleBracket|LeftArrow|LeftArrowBar|LeftArrowRightArrow|LeftCeiling",
  "LeftDoubleBracket|LeftDownTeeVector|LeftDownVector|LeftDownVectorBar|LeftFloor|LeftRightArrow|LeftRightVector|LeftTee|LeftTeeArrow|LeftTeeVector|LeftTriangle|LeftTriangleBar|LeftTriangleEqual|LeftUpDownVector|LeftUpTeeVector|LeftUpVector|LeftUpVectorBar|LeftVector|LeftVectorBar|Leftarrow|Leftrightarrow|LessEqualGreater|LessFullEqual|LessGreater|LessLess|LessSlantEqual|LessTilde|Lfr|Ll|Lleftarrow|Lmidot|LongLeftArrow|LongLeftRightArrow|LongRightArrow|Longleftarrow|Longleftrightarrow|Longrightarrow|Lopf|LowerLeftArrow|LowerRightArrow|Lscr|Lsh|Lstrok|Lt|Map|Mcy|MediumSpace|Mellintrf|Mfr|MinusPlus|Mopf|Mscr|Mu|NJcy|Nacute|Ncaron|Ncedil|Ncy|NegativeMediumSpace|NegativeThickSpace|NegativeThinSpace|NegativeVeryThinSpace|NestedGreaterGreater|NestedLessLess|NewLine|Nfr|NoBreak|NonBreakingSpace|Nopf|Not|NotCongruent|NotCupCap|NotDoubleVerticalBar|NotElement|NotEqual|NotEqualTilde|NotExists|NotGreater|NotGreaterEqual|NotGreaterFullEqual",
  "NotGreaterGreater|NotGreaterLess|NotGreaterSlantEqual|NotGreaterTilde|NotHumpDownHump|NotHumpEqual|NotLeftTriangle|NotLeftTriangleBar|NotLeftTriangleEqual|NotLess|NotLessEqual|NotLessGreater|NotLessLess|NotLessSlantEqual|NotLessTilde|NotNestedGreaterGreater|NotNestedLessLess|NotPrecedes|NotPrecedesEqual|NotPrecedesSlantEqual|NotReverseElement|NotRightTriangle|NotRightTriangleBar|NotRightTriangleEqual|NotSquareSubset|NotSquareSubsetEqual|NotSquareSuperset|NotSquareSupersetEqual|NotSubset|NotSubsetEqual|NotSucceeds|NotSucceedsEqual|NotSucceedsSlantEqual|NotSucceedsTilde|NotSuperset|NotSupersetEqual|NotTilde|NotTildeEqual|NotTildeFullEqual|NotTildeTilde|NotVerticalBar|Nscr|Ntilde|Nu|OElig|Oacute|Ocirc|Ocy|Odblac|Ofr|Ograve|Omacr|Omega|Omicron|Oopf|OpenCurlyDoubleQuote|OpenCurlyQuote|Or|Oscr|Oslash|Otilde|Otimes|Ouml|OverBar|OverBrace|OverBracket|OverParenthesis|PartialD|Pcy|Pfr|Phi|Pi|PlusMinus|Poincareplane|Popf|Pr|Precedes|PrecedesEqual|PrecedesSlantEqual|PrecedesTilde",
  "Prime|Product|Proportion|Proportional|Pscr|Psi|QUOT|Qfr|Qopf|Qscr|RBarr|REG|Racute|Rang|Rarr|Rarrtl|Rcaron|Rcedil|Rcy|Re|ReverseElement|ReverseEquilibrium|ReverseUpEquilibrium|Rfr|Rho|RightAngleBracket|RightArrow|RightArrowBar|RightArrowLeftArrow|RightCeiling|RightDoubleBracket|RightDownTeeVector|RightDownVector|RightDownVectorBar|RightFloor|RightTee|RightTeeArrow|RightTeeVector|RightTriangle|RightTriangleBar|RightTriangleEqual|RightUpDownVector|RightUpTeeVector|RightUpVector|RightUpVectorBar|RightVector|RightVectorBar|Rightarrow|Ropf|RoundImplies|Rrightarrow|Rscr|Rsh|RuleDelayed|SHCHcy|SHcy|SOFTcy|Sacute|Sc|Scaron|Scedil|Scirc|Scy|Sfr|ShortDownArrow|ShortLeftArrow|ShortRightArrow|ShortUpArrow|Sigma|SmallCircle|Sopf|Sqrt|Square|SquareIntersection|SquareSubset|SquareSubsetEqual|SquareSuperset|SquareSupersetEqual|SquareUnion|Sscr",
  "Star|Sub|Subset|SubsetEqual|Succeeds|SucceedsEqual|SucceedsSlantEqual|SucceedsTilde|SuchThat|Sum|Sup|Superset|SupersetEqual|Supset|THORN|TRADE|TSHcy|TScy|Tab|Tau|Tcaron|Tcedil|Tcy|Tfr|Therefore|Theta|ThickSpace|ThinSpace|Tilde|TildeEqual|TildeFullEqual|TildeTilde|Topf|TripleDot|Tscr|Tstrok|Uacute|Uarr|Uarrocir|Ubrcy|Ubreve|Ucirc|Ucy|Udblac|Ufr|Ugrave|Umacr|UnderBar|UnderBrace|UnderBracket|UnderParenthesis|Union|UnionPlus|Uogon|Uopf|UpArrow|UpArrowBar|UpArrowDownArrow|UpDownArrow|UpEquilibrium|UpTee|UpTeeArrow|Uparrow|Updownarrow|UpperLeftArrow|UpperRightArrow|Upsi|Upsilon|Uring|Uscr|Utilde|Uuml|VDash|Vbar|Vcy|Vdash|Vdashl|Vee|Verbar|Vert",
  "VerticalBar|VerticalLine|VerticalSeparator|VerticalTilde|VeryThinSpace|Vfr|Vopf|Vscr|Vvdash|Wcirc|Wedge|Wfr|Wopf|Wscr|Xfr|Xi|Xopf|Xscr|YAcy|YIcy|YUcy|Yacute|Ycirc|Ycy|Yfr|Yopf|Yscr|Yuml|ZHcy|Zacute|Zcaron|Zcy|Zdot|ZeroWidthSpace|Zeta|Zfr|Zopf|Zscr|aacute|abreve|ac|acE|acd|acirc|acute|acy|aelig|af|afr|agrave|alefsym|aleph|alpha|amacr|amalg|amp|and|andand|andd|andslope|andv|ang|ange|angle|angmsd|angmsdaa|angmsdab|angmsdac|angmsdad|angmsdae|angmsdaf|angmsdag|angmsdah|angrt|angrtvb|angrtvbd|angsph|angst|angzarr|aogon",
  "aopf|ap|apE|apacir|ape|apid|apos|approx|approxeq|aring|ascr|ast|asymp|asympeq|atilde|auml|awconint|awint|bNot|backcong|backepsilon|backprime|backsim|backsimeq|barvee|barwed|barwedge|bbrk|bbrktbrk|bcong|bcy|bdquo|becaus|because|bemptyv|bepsi|bernou|beta|beth|between|bfr|bigcap|bigcirc|bigcup|bigodot|bigoplus|bigotimes|bigsqcup|bigstar|bigtriangledown|bigtriangleup|biguplus|bigvee|bigwedge|bkarow|blacklozenge|blacksquare|blacktriangle|blacktriangledown|blacktriangleleft|blacktriangleright|blank|blk12|blk14|blk34|block|bne|bnequiv|bnot|bopf|bot|bottom|bowtie|boxDL|boxDR|boxDl|boxDr|boxH|boxHD|boxHU",
  "boxHd|boxHu|boxUL|boxUR|boxUl|boxUr|boxV|boxVH|boxVL|boxVR|boxVh|boxVl|boxVr|boxbox|boxdL|boxdR|boxdl|boxdr|boxh|boxhD|boxhU|boxhd|boxhu|boxminus|boxplus|boxtimes|boxuL|boxuR|boxul|boxur|boxv|boxvH|boxvL|boxvR|boxvh|boxvl|boxvr|bprime|breve|brvbar|bscr|bsemi|bsim|bsime|bsol|bsolb|bsolhsub|bull|bullet|bump|bumpE|bumpe|bumpeq|cacute|cap|capand|capbrcup|capcap|capcup|capdot|caps|caret|caron|ccaps|ccaron|ccedil|ccirc|ccups|ccupssm|cdot|cedil|cemptyv|cent|centerdot|cfr|chcy|check|checkmark|chi|cir",
  "cirE|circ|circeq|circlearrowleft|circlearrowright|circledR|circledS|circledast|circledcirc|circleddash|cire|cirfnint|cirmid|cirscir|clubs|clubsuit|colon|colone|coloneq|comma|commat|comp|compfn|complement|complexes|cong|congdot|conint|copf|coprod|copy|copysr|crarr|cross|cscr|csub|csube|csup|csupe|ctdot|cudarrl|cudarrr|cuepr|cuesc|cularr|cularrp|cup|cupbrcap|cupcap|cupcup|cupdot|cupor|cups|curarr|curarrm|curlyeqprec|curlyeqsucc|curlyvee|curlywedge|curren|curvearrowleft|curvearrowright|cuvee|cuwed|cwconint|cwint|cylcty|dArr|dHar|dagger|daleth|darr|dash|dashv|dbkarow|dblac|dcaron|dcy|dd|ddagger",
  "ddarr|ddotseq|deg|delta|demptyv|dfisht|dfr|dharl|dharr|diam|diamond|diamondsuit|diams|die|digamma|disin|div|divide|divideontimes|divonx|djcy|dlcorn|dlcrop|dollar|dopf|dot|doteq|doteqdot|dotminus|dotplus|dotsquare|doublebarwedge|downarrow|downdownarrows|downharpoonleft|downharpoonright|drbkarow|drcorn|drcrop|dscr|dscy|dsol|dstrok|dtdot|dtri|dtrif|duarr|duhar|dwangle|dzcy|dzigrarr|eDDot|eDot|eacute|easter|ecaron|ecir|ecirc|ecolon|ecy|edot|ee|efDot|efr|eg|egrave|egs|egsdot|el|elinters|ell|els|elsdot|emacr|empty|emptyset|emptyv|emsp|emsp13|emsp14",
  "eng|ensp|eogon|eopf|epar|eparsl|eplus|epsi|epsilon|epsiv|eqcirc|eqcolon|eqsim|eqslantgtr|eqslantless|equals|equest|equiv|equivDD|eqvparsl|erDot|erarr|escr|esdot|esim|eta|eth|euml|euro|excl|exist|expectation|exponentiale|fallingdotseq|fcy|female|ffilig|fflig|ffllig|ffr|filig|fjlig|flat|fllig|fltns|fnof|fopf|forall|fork|forkv|fpartint|frac12|frac13|frac14|frac15|frac16|frac18|frac23|frac25|frac34|frac35|frac38|frac45|frac56|frac58|frac78|frasl|frown|fscr|gE|gEl|gacute|gamma|gammad|gap|gbreve|gcirc|gcy|gdot|ge",
  "gel|geq|geqq|geqslant|ges|gescc|gesdot|gesdoto|gesdotol|gesl|gesles|gfr|gg|ggg|gimel|gjcy|gl|glE|gla|glj|gnE|gnap|gnapprox|gne|gneq|gneqq|gnsim|gopf|grave|gscr|gsim|gsime|gsiml|gt|gtcc|gtcir|gtdot|gtlPar|gtquest|gtrapprox|gtrarr|gtrdot|gtreqless|gtreqqless|gtrless|gtrsim|gvertneqq|gvnE|hArr|hairsp|half|hamilt|hardcy|harr|harrcir|harrw|hbar|hcirc|hearts|heartsuit|hellip|hercon|hfr|hksearow|hkswarow|hoarr|homtht|hookleftarrow|hookrightarrow|hopf|horbar|hscr|hslash|hstrok|hybull|hyphen|iacute|ic|icirc|icy",
  "iecy|iexcl|iff|ifr|igrave|ii|iiiint|iiint|iinfin|iiota|ijlig|imacr|image|imagline|imagpart|imath|imof|imped|in|incare|infin|infintie|inodot|int|intcal|integers|intercal|intlarhk|intprod|iocy|iogon|iopf|iota|iprod|iquest|iscr|isin|isinE|isindot|isins|isinsv|isinv|it|itilde|iukcy|iuml|jcirc|jcy|jfr|jmath|jopf|jscr|jsercy|jukcy|kappa|kappav|kcedil|kcy|kfr|kgreen|khcy|kjcy|kopf|kscr|lAarr|lArr|lAtail|lBarr|lE|lEg|lHar|lacute|laemptyv|lagran|lambda|lang|langd|langle|lap|laquo",
  "larr|larrb|larrbfs|larrfs|larrhk|larrlp|larrpl|larrsim|larrtl|lat|latail|late|lates|lbarr|lbbrk|lbrace|lbrack|lbrke|lbrksld|lbrkslu|lcaron|lcedil|lceil|lcub|lcy|ldca|ldquo|ldquor|ldrdhar|ldrushar|ldsh|le|leftarrow|leftarrowtail|leftharpoondown|leftharpoonup|leftleftarrows|leftrightarrow|leftrightarrows|leftrightharpoons|leftrightsquigarrow|leftthreetimes|leg|leq|leqq|leqslant|les|lescc|lesdot|lesdoto|lesdotor|lesg|lesges|lessapprox|lessdot|lesseqgtr|lesseqqgtr|lessgtr|lesssim|lfisht|lfloor|lfr|lg|lgE|lhard|lharu|lharul|lhblk|ljcy|ll|llarr|llcorner|llhard|lltri|lmidot|lmoust|lmoustache|lnE|lnap|lnapprox",
  "lne|lneq|lneqq|lnsim|loang|loarr|lobrk|longleftarrow|longleftrightarrow|longmapsto|longrightarrow|looparrowleft|looparrowright|lopar|lopf|loplus|lotimes|lowast|lowbar|loz|lozenge|lozf|lpar|lparlt|lrarr|lrcorner|lrhar|lrhard|lrm|lrtri|lsaquo|lscr|lsh|lsim|lsime|lsimg|lsqb|lsquo|lsquor|lstrok|lt|ltcc|ltcir|ltdot|lthree|ltimes|ltlarr|ltquest|ltrPar|ltri|ltrie|ltrif|lurdshar|luruhar|lvertneqq|lvnE|mDDot|macr|male|malt|maltese|map|mapsto|mapstodown|mapstoleft|mapstoup|marker|mcomma|mcy|mdash|measuredangle|mfr|mho|micro|mid|midast|midcir|middot|minus|minusb",
  "minusd|minusdu|mlcp|mldr|mnplus|models|mopf|mp|mscr|mstpos|mu|multimap|mumap|nGg|nGt|nGtv|nLeftarrow|nLeftrightarrow|nLl|nLt|nLtv|nRightarrow|nVDash|nVdash|nabla|nacute|nang|nap|napE|napid|napos|napprox|natur|natural|naturals|nbsp|nbump|nbumpe|ncap|ncaron|ncedil|ncong|ncongdot|ncup|ncy|ndash|ne|neArr|nearhk|nearr|nearrow|nedot|nequiv|nesear|nesim|nexist|nexists|nfr|ngE|nge|ngeq|ngeqq|ngeqslant|nges|ngsim|ngt|ngtr|nhArr|nharr|nhpar|ni|nis|nisd|niv|njcy|nlArr|nlE|nlarr|nldr|nle",
  "nleftarrow|nleftrightarrow|nleq|nleqq|nleqslant|nles|nless|nlsim|nlt|nltri|nltrie|nmid|nopf|not|notin|notinE|notindot|notinva|notinvb|notinvc|notni|notniva|notnivb|notnivc|npar|nparallel|nparsl|npart|npolint|npr|nprcue|npre|nprec|npreceq|nrArr|nrarr|nrarrc|nrarrw|nrightarrow|nrtri|nrtrie|nsc|nsccue|nsce|nscr|nshortmid|nshortparallel|nsim|nsime|nsimeq|nsmid|nspar|nsqsube|nsqsupe|nsub|nsubE|nsube|nsubset|nsubseteq|nsubseteqq|nsucc|nsucceq|nsup|nsupE|nsupe|nsupset|nsupseteq|nsupseteqq|ntgl|ntilde|ntlg|ntriangleleft|ntrianglelefteq|ntriangleright|ntrianglerighteq|nu|num|numero|numsp|nvDash",
  "nvHarr|nvap|nvdash|nvge|nvgt|nvinfin|nvlArr|nvle|nvlt|nvltrie|nvrArr|nvrtrie|nvsim|nwArr|nwarhk|nwarr|nwarrow|nwnear|oS|oacute|oast|ocir|ocirc|ocy|odash|odblac|odiv|odot|odsold|oelig|ofcir|ofr|ogon|ograve|ogt|ohbar|ohm|oint|olarr|olcir|olcross|oline|olt|omacr|omega|omicron|omid|ominus|oopf|opar|operp|oplus|or|orarr|ord|order|orderof|ordf|ordm|origof|oror|orslope|orv|oscr|oslash|osol|otilde|otimes|otimesas|ouml|ovbar|par|para|parallel|parsim|parsl|part|pcy|percnt|period",
  "permil|perp|pertenk|pfr|phi|phiv|phmmat|phone|pi|pitchfork|piv|planck|planckh|plankv|plus|plusacir|plusb|pluscir|plusdo|plusdu|pluse|plusmn|plussim|plustwo|pm|pointint|popf|pound|pr|prE|prap|prcue|pre|prec|precapprox|preccurlyeq|preceq|precnapprox|precneqq|precnsim|precsim|prime|primes|prnE|prnap|prnsim|prod|profalar|profline|profsurf|prop|propto|prsim|prurel|pscr|psi|puncsp|qfr|qint|qopf|qprime|qscr|quaternions|quatint|quest|questeq|quot|rAarr|rArr|rAtail|rBarr|rHar|race|racute|radic|raemptyv|rang|rangd|range|rangle",
  "raquo|rarr|rarrap|rarrb|rarrbfs|rarrc|rarrfs|rarrhk|rarrlp|rarrpl|rarrsim|rarrtl|rarrw|ratail|ratio|rationals|rbarr|rbbrk|rbrace|rbrack|rbrke|rbrksld|rbrkslu|rcaron|rcedil|rceil|rcub|rcy|rdca|rdldhar|rdquo|rdquor|rdsh|real|realine|realpart|reals|rect|reg|rfisht|rfloor|rfr|rhard|rharu|rharul|rho|rhov|rightarrow|rightarrowtail|rightharpoondown|rightharpoonup|rightleftarrows|rightleftharpoons|rightrightarrows|rightsquigarrow|rightthreetimes|ring|risingdotseq|rlarr|rlhar|rlm|rmoust|rmoustache|rnmid|roang|roarr|robrk|ropar|ropf|roplus|rotimes|rpar|rpargt|rppolint|rrarr|rsaquo|rscr|rsh|rsqb|rsquo",
  "rsquor|rthree|rtimes|rtri|rtrie|rtrif|rtriltri|ruluhar|rx|sacute|sbquo|sc|scE|scap|scaron|sccue|sce|scedil|scirc|scnE|scnap|scnsim|scpolint|scsim|scy|sdot|sdotb|sdote|seArr|searhk|searr|searrow|sect|semi|seswar|setminus|setmn|sext|sfr|sfrown|sharp|shchcy|shcy|shortmid|shortparallel|shy|sigma|sigmaf|sigmav|sim|simdot|sime|simeq|simg|simgE|siml|simlE|simne|simplus|simrarr|slarr|smallsetminus|smashp|smeparsl|smid|smile|smt|smte|smtes|softcy|sol|solb|solbar|sopf|spades|spadesuit|spar|sqcap|sqcaps|sqcup",
  "sqcups|sqsub|sqsube|sqsubset|sqsubseteq|sqsup|sqsupe|sqsupset|sqsupseteq|squ|square|squarf|squf|srarr|sscr|ssetmn|ssmile|sstarf|star|starf|straightepsilon|straightphi|strns|sub|subE|subdot|sube|subedot|submult|subnE|subne|subplus|subrarr|subset|subseteq|subseteqq|subsetneq|subsetneqq|subsim|subsub|subsup|succ|succapprox|succcurlyeq|succeq|succnapprox|succneqq|succnsim|succsim|sum|sung|sup|sup1|sup2|sup3|supE|supdot|supdsub|supe|supedot|suphsol|suphsub|suplarr|supmult|supnE|supne|supplus|supset|supseteq|supseteqq|supsetneq|supsetneqq|supsim|supsub|supsup|swArr|swarhk|swarr|swarrow|swnwar",
  "szlig|target|tau|tbrk|tcaron|tcedil|tcy|tdot|telrec|tfr|there4|therefore|theta|thetasym|thetav|thickapprox|thicksim|thinsp|thkap|thksim|thorn|tilde|times|timesb|timesbar|timesd|tint|toea|top|topbot|topcir|topf|topfork|tosa|tprime|trade|triangle|triangledown|triangleleft|trianglelefteq|triangleq|triangleright|trianglerighteq|tridot|trie|triminus|triplus|trisb|tritime|trpezium|tscr|tscy|tshcy|tstrok|twixt|twoheadleftarrow|twoheadrightarrow|uArr|uHar|uacute|uarr|ubrcy|ubreve|ucirc|ucy|udarr|udblac|udhar|ufisht|ufr|ugrave|uharl|uharr|uhblk|ulcorn|ulcorner|ulcrop|ultri|umacr|uml",
  "uogon|uopf|uparrow|updownarrow|upharpoonleft|upharpoonright|uplus|upsi|upsih|upsilon|upuparrows|urcorn|urcorner|urcrop|uring|urtri|uscr|utdot|utilde|utri|utrif|uuarr|uuml|uwangle|vArr|vBar|vBarv|vDash|vangrt|varepsilon|varkappa|varnothing|varphi|varpi|varpropto|varr|varrho|varsigma|varsubsetneq|varsubsetneqq|varsupsetneq|varsupsetneqq|vartheta|vartriangleleft|vartriangleright|vcy|vdash|vee|veebar|veeeq|vellip|verbar|vert|vfr|vltri|vnsub|vnsup|vopf|vprop|vrtri|vscr|vsubnE|vsubne|vsupnE|vsupne|vzigzag|wcirc|wedbar|wedge|wedgeq|weierp|wfr|wopf|wp|wr|wreath|wscr|xcap|xcirc|xcup",
  "xdtri|xfr|xhArr|xharr|xi|xlArr|xlarr|xmap|xnis|xodot|xopf|xoplus|xotime|xrArr|xrarr|xscr|xsqcup|xuplus|xutri|xvee|xwedge|yacute|yacy|ycirc|ycy|yen|yfr|yicy|yopf|yscr|yucy|yuml|zacute|zcaron|zcy|zdot|zeetrf|zeta|zfr|zhcy|zigrarr|zopf|zscr|zwj|zwnj",
].join("|").split("|"));
const legacyHtmlNames = Object.keys(LEGACY_HTML_NAMES).sort((a, b) => b.length - a.length);

function canonicalizeLegacyHtmlReferences(text, isRawHtmlText) {
  return text.replace(/&([A-Za-z][A-Za-z0-9]*)(;?)/g, (entity, token, semicolon, index) => {
    if ((semicolon && HTML_ENTITY_NAMES.has(token)) || !isRawHtmlText(index)) return entity;
    const name = legacyHtmlNames.find((candidate) => token.startsWith(candidate));
    return name ? Array.from(LEGACY_HTML_NAMES[name], (character) => "&#" + character.codePointAt(0) + ";").join("") + token.slice(name.length) + semicolon : entity;
  });
}

// CommonMark delimiter runs: flanking, intraword underscores, and rule of three.
function nextEqualTickRuns(ticks) {
  const nextByLength = new Map();
  const successors = new Array(ticks.length);
  for (let index = ticks.length - 1; index >= 0; index -= 1) {
    const length = ticks[index][0].length;
    successors[index] = nextByLength.get(length);
    nextByLength.set(length, ticks[index]);
  }
  return successors;
}

function activeMarkdownEmphasis(text) {
  const removed = new Set();
  const runs = [];
  const whitespace = (value) => !value || /\s/u.test(value);
  const punctuation = (value) => !!value && /[\p{P}\p{S}]/u.test(value);
  const escaped = (index) => !markdownLinkOpenerAllowed(text, index);
  // Matched code-span delimiters disappear; their literal content is protected
  // by the existing code-context stage before this projection.
  const ticks = [...text.matchAll(/`+/g)];
  const nextTicks = nextEqualTickRuns(ticks);
  let consumed = 0;
  for (let i = 0; i < ticks.length; i += 1) {
    const start = ticks[i];
    if (start.index < consumed || escaped(start.index)) continue;
    const end = nextTicks[i];
    if (!end) continue;
    for (let j = 0; j < start[0].length; j += 1) { removed.add(start.index + j); removed.add(end.index + j); }
    consumed = end.index + end[0].length;
  }
  for (const match of text.matchAll(/\*+|_+|~{2,}/g)) {
    if (escaped(match.index)) continue;
    const beforeIndex = match.index - (match.index >= 2 && /[\uDC00-\uDFFF]/.test(text[match.index - 1]) && /[\uD800-\uDBFF]/.test(text[match.index - 2]) ? 2 : 1);
    const before = beforeIndex >= 0 ? String.fromCodePoint(text.codePointAt(beforeIndex)) : "";
    const afterIndex = match.index + match[0].length;
    const after = afterIndex < text.length ? String.fromCodePoint(text.codePointAt(afterIndex)) : "";
    const left = !whitespace(after) && (!punctuation(after) || whitespace(before) || punctuation(before));
    const right = !whitespace(before) && (!punctuation(before) || whitespace(after) || punctuation(after));
    runs.push({ character: match[0][0], start: match.index, length: match[0].length, usedOpen: 0, usedClose: 0,
      open: match[0][0] === "_" ? left && (!right || punctuation(before)) : left,
      close: match[0][0] === "_" ? right && (!left || punctuation(after)) : right });
  }
  const eligibleOpeners = new Map();
  for (let closeIndex = 0; closeIndex < runs.length; closeIndex += 1) {
    const closer = runs[closeIndex];
    const candidates = eligibleOpeners.get(closer.character) || [];
    if (closer.close) for (let candidate = candidates.length - 1; candidate >= 0 && closer.length - closer.usedClose >= (closer.character === "~" ? 2 : 1); candidate -= 1) {
      const openIndex = candidates[candidate];
      const opener = runs[openIndex];
      if (!opener.open || opener.character !== closer.character || /\r?\n[ \t\f\v]*\r?\n/.test(text.slice(opener.start, closer.start))) continue;
      let availableOpen = opener.length - opener.usedOpen - opener.usedClose;
      let availableClose = closer.length - closer.usedOpen - closer.usedClose;
      if (availableOpen < (closer.character === "~" ? 2 : 1)) continue;
      if (closer.character !== "~" && (opener.close || closer.open) &&
          (availableOpen + availableClose) % 3 === 0 && (availableOpen % 3 !== 0 || availableClose % 3 !== 0)) continue;
      while (availableOpen >= (closer.character === "~" ? 2 : 1) && availableClose >= (closer.character === "~" ? 2 : 1)) {
        const count = availableOpen >= 2 && availableClose >= 2 ? 2 : 1;
        for (let j = 0; j < count; j += 1) {
          removed.add(opener.start + opener.length - opener.usedOpen - 1 - j);
          removed.add(closer.start + closer.usedClose + j);
        }
        opener.usedOpen += count; closer.usedClose += count;
        for (let nested = openIndex + 1; nested < closeIndex; nested += 1) { runs[nested].open = false; runs[nested].close = false; }
        availableOpen -= count; availableClose -= count;
      }
    }
    if (closer.open) {
      candidates.push(closeIndex);
      eligibleOpeners.set(closer.character, candidates);
    }
  }
  return text.split("").map((character, index) => removed.has(index) ? "" : character).join("");
}

const HTML_NAMED_ENTITIES = Object.freeze({
  "AElig": "\u00c6", "AMP": "&", "Aacute": "\u00c1", "Abreve": "\u0102", "Acirc": "\u00c2", "Acy": "\u0410",
  "Afr": "\ud835\udd04", "Agrave": "\u00c0", "Alpha": "\u0391", "Amacr": "\u0100", "And": "\u2a53", "Aogon": "\u0104",
  "Aopf": "\ud835\udd38", "ApplyFunction": "\u2061", "Aring": "\u00c5", "Ascr": "\ud835\udc9c", "Assign": "\u2254", "Atilde": "\u00c3",
  "Auml": "\u00c4", "Backslash": "\u2216", "Barv": "\u2ae7", "Barwed": "\u2306", "Bcy": "\u0411", "Because": "\u2235",
  "Bernoullis": "\u212c", "Beta": "\u0392", "Bfr": "\ud835\udd05", "Bopf": "\ud835\udd39", "Breve": "\u02d8", "Bscr": "\u212c",
  "Bumpeq": "\u224e", "CHcy": "\u0427", "COPY": "\u00a9", "Cacute": "\u0106", "Cap": "\u22d2", "CapitalDifferentialD": "\u2145",
  "Cayleys": "\u212d", "Ccaron": "\u010c", "Ccedil": "\u00c7", "Ccirc": "\u0108", "Cconint": "\u2230", "Cdot": "\u010a",
  "Cedilla": "\u00b8", "CenterDot": "\u00b7", "Cfr": "\u212d", "Chi": "\u03a7", "CircleDot": "\u2299", "CircleMinus": "\u2296",
  "CirclePlus": "\u2295", "CircleTimes": "\u2297", "ClockwiseContourIntegral": "\u2232", "CloseCurlyDoubleQuote": "\u201d", "CloseCurlyQuote": "\u2019", "Colon": "\u2237",
  "Colone": "\u2a74", "Congruent": "\u2261", "Conint": "\u222f", "ContourIntegral": "\u222e", "Copf": "\u2102", "Coproduct": "\u2210",
  "CounterClockwiseContourIntegral": "\u2233", "Cross": "\u2a2f", "Cscr": "\ud835\udc9e", "Cup": "\u22d3", "CupCap": "\u224d", "DD": "\u2145",
  "DDotrahd": "\u2911", "DJcy": "\u0402", "DScy": "\u0405", "DZcy": "\u040f", "Dagger": "\u2021", "Darr": "\u21a1",
  "Dashv": "\u2ae4", "Dcaron": "\u010e", "Dcy": "\u0414", "Del": "\u2207", "Delta": "\u0394", "Dfr": "\ud835\udd07",
  "DiacriticalAcute": "\u00b4", "DiacriticalDot": "\u02d9", "DiacriticalDoubleAcute": "\u02dd", "DiacriticalGrave": "`", "DiacriticalTilde": "\u02dc", "Diamond": "\u22c4",
  "DifferentialD": "\u2146", "Dopf": "\ud835\udd3b", "Dot": "\u00a8", "DotDot": "\u20dc", "DotEqual": "\u2250", "DoubleContourIntegral": "\u222f",
  "DoubleDot": "\u00a8", "DoubleDownArrow": "\u21d3", "DoubleLeftArrow": "\u21d0", "DoubleLeftRightArrow": "\u21d4", "DoubleLeftTee": "\u2ae4", "DoubleLongLeftArrow": "\u27f8",
  "DoubleLongLeftRightArrow": "\u27fa", "DoubleLongRightArrow": "\u27f9", "DoubleRightArrow": "\u21d2", "DoubleRightTee": "\u22a8", "DoubleUpArrow": "\u21d1", "DoubleUpDownArrow": "\u21d5",
  "DoubleVerticalBar": "\u2225", "DownArrow": "\u2193", "DownArrowBar": "\u2913", "DownArrowUpArrow": "\u21f5", "DownBreve": "\u0311", "DownLeftRightVector": "\u2950",
  "DownLeftTeeVector": "\u295e", "DownLeftVector": "\u21bd", "DownLeftVectorBar": "\u2956", "DownRightTeeVector": "\u295f", "DownRightVector": "\u21c1", "DownRightVectorBar": "\u2957",
  "DownTee": "\u22a4", "DownTeeArrow": "\u21a7", "Downarrow": "\u21d3", "Dscr": "\ud835\udc9f", "Dstrok": "\u0110", "ENG": "\u014a",
  "ETH": "\u00d0", "Eacute": "\u00c9", "Ecaron": "\u011a", "Ecirc": "\u00ca", "Ecy": "\u042d", "Edot": "\u0116",
  "Efr": "\ud835\udd08", "Egrave": "\u00c8", "Element": "\u2208", "Emacr": "\u0112", "EmptySmallSquare": "\u25fb", "EmptyVerySmallSquare": "\u25ab",
  "Eogon": "\u0118", "Eopf": "\ud835\udd3c", "Epsilon": "\u0395", "Equal": "\u2a75", "EqualTilde": "\u2242", "Equilibrium": "\u21cc",
  "Escr": "\u2130", "Esim": "\u2a73", "Eta": "\u0397", "Euml": "\u00cb", "Exists": "\u2203", "ExponentialE": "\u2147",
  "Fcy": "\u0424", "Ffr": "\ud835\udd09", "FilledSmallSquare": "\u25fc", "FilledVerySmallSquare": "\u25aa", "Fopf": "\ud835\udd3d", "ForAll": "\u2200",
  "Fouriertrf": "\u2131", "Fscr": "\u2131", "GJcy": "\u0403", "GT": ">", "Gamma": "\u0393", "Gammad": "\u03dc",
  "Gbreve": "\u011e", "Gcedil": "\u0122", "Gcirc": "\u011c", "Gcy": "\u0413", "Gdot": "\u0120", "Gfr": "\ud835\udd0a",
  "Gg": "\u22d9", "Gopf": "\ud835\udd3e", "GreaterEqual": "\u2265", "GreaterEqualLess": "\u22db", "GreaterFullEqual": "\u2267", "GreaterGreater": "\u2aa2",
  "GreaterLess": "\u2277", "GreaterSlantEqual": "\u2a7e", "GreaterTilde": "\u2273", "Gscr": "\ud835\udca2", "Gt": "\u226b", "HARDcy": "\u042a",
  "Hacek": "\u02c7", "Hat": "^", "Hcirc": "\u0124", "Hfr": "\u210c", "HilbertSpace": "\u210b", "Hopf": "\u210d",
  "HorizontalLine": "\u2500", "Hscr": "\u210b", "Hstrok": "\u0126", "HumpDownHump": "\u224e", "HumpEqual": "\u224f", "IEcy": "\u0415",
  "IJlig": "\u0132", "IOcy": "\u0401", "Iacute": "\u00cd", "Icirc": "\u00ce", "Icy": "\u0418", "Idot": "\u0130",
  "Ifr": "\u2111", "Igrave": "\u00cc", "Im": "\u2111", "Imacr": "\u012a", "ImaginaryI": "\u2148", "Implies": "\u21d2",
  "Int": "\u222c", "Integral": "\u222b", "Intersection": "\u22c2", "InvisibleComma": "\u2063", "InvisibleTimes": "\u2062", "Iogon": "\u012e",
  "Iopf": "\ud835\udd40", "Iota": "\u0399", "Iscr": "\u2110", "Itilde": "\u0128", "Iukcy": "\u0406", "Iuml": "\u00cf",
  "Jcirc": "\u0134", "Jcy": "\u0419", "Jfr": "\ud835\udd0d", "Jopf": "\ud835\udd41", "Jscr": "\ud835\udca5", "Jsercy": "\u0408",
  "Jukcy": "\u0404", "KHcy": "\u0425", "KJcy": "\u040c", "Kappa": "\u039a", "Kcedil": "\u0136", "Kcy": "\u041a",
  "Kfr": "\ud835\udd0e", "Kopf": "\ud835\udd42", "Kscr": "\ud835\udca6", "LJcy": "\u0409", "LT": "<", "Lacute": "\u0139",
  "Lambda": "\u039b", "Lang": "\u27ea", "Laplacetrf": "\u2112", "Larr": "\u219e", "Lcaron": "\u013d", "Lcedil": "\u013b",
  "Lcy": "\u041b", "LeftAngleBracket": "\u27e8", "LeftArrow": "\u2190", "LeftArrowBar": "\u21e4", "LeftArrowRightArrow": "\u21c6", "LeftCeiling": "\u2308",
  "LeftDoubleBracket": "\u27e6", "LeftDownTeeVector": "\u2961", "LeftDownVector": "\u21c3", "LeftDownVectorBar": "\u2959", "LeftFloor": "\u230a", "LeftRightArrow": "\u2194",
  "LeftRightVector": "\u294e", "LeftTee": "\u22a3", "LeftTeeArrow": "\u21a4", "LeftTeeVector": "\u295a", "LeftTriangle": "\u22b2", "LeftTriangleBar": "\u29cf",
  "LeftTriangleEqual": "\u22b4", "LeftUpDownVector": "\u2951", "LeftUpTeeVector": "\u2960", "LeftUpVector": "\u21bf", "LeftUpVectorBar": "\u2958", "LeftVector": "\u21bc",
  "LeftVectorBar": "\u2952", "Leftarrow": "\u21d0", "Leftrightarrow": "\u21d4", "LessEqualGreater": "\u22da", "LessFullEqual": "\u2266", "LessGreater": "\u2276",
  "LessLess": "\u2aa1", "LessSlantEqual": "\u2a7d", "LessTilde": "\u2272", "Lfr": "\ud835\udd0f", "Ll": "\u22d8", "Lleftarrow": "\u21da",
  "Lmidot": "\u013f", "LongLeftArrow": "\u27f5", "LongLeftRightArrow": "\u27f7", "LongRightArrow": "\u27f6", "Longleftarrow": "\u27f8", "Longleftrightarrow": "\u27fa",
  "Longrightarrow": "\u27f9", "Lopf": "\ud835\udd43", "LowerLeftArrow": "\u2199", "LowerRightArrow": "\u2198", "Lscr": "\u2112", "Lsh": "\u21b0",
  "Lstrok": "\u0141", "Lt": "\u226a", "Map": "\u2905", "Mcy": "\u041c", "MediumSpace": "\u205f", "Mellintrf": "\u2133",
  "Mfr": "\ud835\udd10", "MinusPlus": "\u2213", "Mopf": "\ud835\udd44", "Mscr": "\u2133", "Mu": "\u039c", "NJcy": "\u040a",
  "Nacute": "\u0143", "Ncaron": "\u0147", "Ncedil": "\u0145", "Ncy": "\u041d", "NegativeMediumSpace": "\u200b", "NegativeThickSpace": "\u200b",
  "NegativeThinSpace": "\u200b", "NegativeVeryThinSpace": "\u200b", "NestedGreaterGreater": "\u226b", "NestedLessLess": "\u226a", "NewLine": "\n", "Nfr": "\ud835\udd11",
  "NoBreak": "\u2060", "NonBreakingSpace": "\u00a0", "Nopf": "\u2115", "Not": "\u2aec", "NotCongruent": "\u2262", "NotCupCap": "\u226d",
  "NotDoubleVerticalBar": "\u2226", "NotElement": "\u2209", "NotEqual": "\u2260", "NotEqualTilde": "\u2242\u0338", "NotExists": "\u2204", "NotGreater": "\u226f",
  "NotGreaterEqual": "\u2271", "NotGreaterFullEqual": "\u2267\u0338", "NotGreaterGreater": "\u226b\u0338", "NotGreaterLess": "\u2279", "NotGreaterSlantEqual": "\u2a7e\u0338", "NotGreaterTilde": "\u2275",
  "NotHumpDownHump": "\u224e\u0338", "NotHumpEqual": "\u224f\u0338", "NotLeftTriangle": "\u22ea", "NotLeftTriangleBar": "\u29cf\u0338", "NotLeftTriangleEqual": "\u22ec", "NotLess": "\u226e",
  "NotLessEqual": "\u2270", "NotLessGreater": "\u2278", "NotLessLess": "\u226a\u0338", "NotLessSlantEqual": "\u2a7d\u0338", "NotLessTilde": "\u2274", "NotNestedGreaterGreater": "\u2aa2\u0338",
  "NotNestedLessLess": "\u2aa1\u0338", "NotPrecedes": "\u2280", "NotPrecedesEqual": "\u2aaf\u0338", "NotPrecedesSlantEqual": "\u22e0", "NotReverseElement": "\u220c", "NotRightTriangle": "\u22eb",
  "NotRightTriangleBar": "\u29d0\u0338", "NotRightTriangleEqual": "\u22ed", "NotSquareSubset": "\u228f\u0338", "NotSquareSubsetEqual": "\u22e2", "NotSquareSuperset": "\u2290\u0338", "NotSquareSupersetEqual": "\u22e3",
  "NotSubset": "\u2282\u20d2", "NotSubsetEqual": "\u2288", "NotSucceeds": "\u2281", "NotSucceedsEqual": "\u2ab0\u0338", "NotSucceedsSlantEqual": "\u22e1", "NotSucceedsTilde": "\u227f\u0338",
  "NotSuperset": "\u2283\u20d2", "NotSupersetEqual": "\u2289", "NotTilde": "\u2241", "NotTildeEqual": "\u2244", "NotTildeFullEqual": "\u2247", "NotTildeTilde": "\u2249",
  "NotVerticalBar": "\u2224", "Nscr": "\ud835\udca9", "Ntilde": "\u00d1", "Nu": "\u039d", "OElig": "\u0152", "Oacute": "\u00d3",
  "Ocirc": "\u00d4", "Ocy": "\u041e", "Odblac": "\u0150", "Ofr": "\ud835\udd12", "Ograve": "\u00d2", "Omacr": "\u014c",
  "Omega": "\u03a9", "Omicron": "\u039f", "Oopf": "\ud835\udd46", "OpenCurlyDoubleQuote": "\u201c", "OpenCurlyQuote": "\u2018", "Or": "\u2a54",
  "Oscr": "\ud835\udcaa", "Oslash": "\u00d8", "Otilde": "\u00d5", "Otimes": "\u2a37", "Ouml": "\u00d6", "OverBar": "\u203e",
  "OverBrace": "\u23de", "OverBracket": "\u23b4", "OverParenthesis": "\u23dc", "PartialD": "\u2202", "Pcy": "\u041f", "Pfr": "\ud835\udd13",
  "Phi": "\u03a6", "Pi": "\u03a0", "PlusMinus": "\u00b1", "Poincareplane": "\u210c", "Popf": "\u2119", "Pr": "\u2abb",
  "Precedes": "\u227a", "PrecedesEqual": "\u2aaf", "PrecedesSlantEqual": "\u227c", "PrecedesTilde": "\u227e", "Prime": "\u2033", "Product": "\u220f",
  "Proportion": "\u2237", "Proportional": "\u221d", "Pscr": "\ud835\udcab", "Psi": "\u03a8", "QUOT": "\"", "Qfr": "\ud835\udd14",
  "Qopf": "\u211a", "Qscr": "\ud835\udcac", "RBarr": "\u2910", "REG": "\u00ae", "Racute": "\u0154", "Rang": "\u27eb",
  "Rarr": "\u21a0", "Rarrtl": "\u2916", "Rcaron": "\u0158", "Rcedil": "\u0156", "Rcy": "\u0420", "Re": "\u211c",
  "ReverseElement": "\u220b", "ReverseEquilibrium": "\u21cb", "ReverseUpEquilibrium": "\u296f", "Rfr": "\u211c", "Rho": "\u03a1", "RightAngleBracket": "\u27e9",
  "RightArrow": "\u2192", "RightArrowBar": "\u21e5", "RightArrowLeftArrow": "\u21c4", "RightCeiling": "\u2309", "RightDoubleBracket": "\u27e7", "RightDownTeeVector": "\u295d",
  "RightDownVector": "\u21c2", "RightDownVectorBar": "\u2955", "RightFloor": "\u230b", "RightTee": "\u22a2", "RightTeeArrow": "\u21a6", "RightTeeVector": "\u295b",
  "RightTriangle": "\u22b3", "RightTriangleBar": "\u29d0", "RightTriangleEqual": "\u22b5", "RightUpDownVector": "\u294f", "RightUpTeeVector": "\u295c", "RightUpVector": "\u21be",
  "RightUpVectorBar": "\u2954", "RightVector": "\u21c0", "RightVectorBar": "\u2953", "Rightarrow": "\u21d2", "Ropf": "\u211d", "RoundImplies": "\u2970",
  "Rrightarrow": "\u21db", "Rscr": "\u211b", "Rsh": "\u21b1", "RuleDelayed": "\u29f4", "SHCHcy": "\u0429", "SHcy": "\u0428",
  "SOFTcy": "\u042c", "Sacute": "\u015a", "Sc": "\u2abc", "Scaron": "\u0160", "Scedil": "\u015e", "Scirc": "\u015c",
  "Scy": "\u0421", "Sfr": "\ud835\udd16", "ShortDownArrow": "\u2193", "ShortLeftArrow": "\u2190", "ShortRightArrow": "\u2192", "ShortUpArrow": "\u2191",
  "Sigma": "\u03a3", "SmallCircle": "\u2218", "Sopf": "\ud835\udd4a", "Sqrt": "\u221a", "Square": "\u25a1", "SquareIntersection": "\u2293",
  "SquareSubset": "\u228f", "SquareSubsetEqual": "\u2291", "SquareSuperset": "\u2290", "SquareSupersetEqual": "\u2292", "SquareUnion": "\u2294", "Sscr": "\ud835\udcae",
  "Star": "\u22c6", "Sub": "\u22d0", "Subset": "\u22d0", "SubsetEqual": "\u2286", "Succeeds": "\u227b", "SucceedsEqual": "\u2ab0",
  "SucceedsSlantEqual": "\u227d", "SucceedsTilde": "\u227f", "SuchThat": "\u220b", "Sum": "\u2211", "Sup": "\u22d1", "Superset": "\u2283",
  "SupersetEqual": "\u2287", "Supset": "\u22d1", "THORN": "\u00de", "TRADE": "\u2122", "TSHcy": "\u040b", "TScy": "\u0426",
  "Tab": "\t", "Tau": "\u03a4", "Tcaron": "\u0164", "Tcedil": "\u0162", "Tcy": "\u0422", "Tfr": "\ud835\udd17",
  "Therefore": "\u2234", "Theta": "\u0398", "ThickSpace": "\u205f\u200a", "ThinSpace": "\u2009", "Tilde": "\u223c", "TildeEqual": "\u2243",
  "TildeFullEqual": "\u2245", "TildeTilde": "\u2248", "Topf": "\ud835\udd4b", "TripleDot": "\u20db", "Tscr": "\ud835\udcaf", "Tstrok": "\u0166",
  "Uacute": "\u00da", "Uarr": "\u219f", "Uarrocir": "\u2949", "Ubrcy": "\u040e", "Ubreve": "\u016c", "Ucirc": "\u00db",
  "Ucy": "\u0423", "Udblac": "\u0170", "Ufr": "\ud835\udd18", "Ugrave": "\u00d9", "Umacr": "\u016a", "UnderBar": "_",
  "UnderBrace": "\u23df", "UnderBracket": "\u23b5", "UnderParenthesis": "\u23dd", "Union": "\u22c3", "UnionPlus": "\u228e", "Uogon": "\u0172",
  "Uopf": "\ud835\udd4c", "UpArrow": "\u2191", "UpArrowBar": "\u2912", "UpArrowDownArrow": "\u21c5", "UpDownArrow": "\u2195", "UpEquilibrium": "\u296e",
  "UpTee": "\u22a5", "UpTeeArrow": "\u21a5", "Uparrow": "\u21d1", "Updownarrow": "\u21d5", "UpperLeftArrow": "\u2196", "UpperRightArrow": "\u2197",
  "Upsi": "\u03d2", "Upsilon": "\u03a5", "Uring": "\u016e", "Uscr": "\ud835\udcb0", "Utilde": "\u0168", "Uuml": "\u00dc",
  "VDash": "\u22ab", "Vbar": "\u2aeb", "Vcy": "\u0412", "Vdash": "\u22a9", "Vdashl": "\u2ae6", "Vee": "\u22c1",
  "Verbar": "\u2016", "Vert": "\u2016", "VerticalBar": "\u2223", "VerticalLine": "|", "VerticalSeparator": "\u2758", "VerticalTilde": "\u2240",
  "VeryThinSpace": "\u200a", "Vfr": "\ud835\udd19", "Vopf": "\ud835\udd4d", "Vscr": "\ud835\udcb1", "Vvdash": "\u22aa", "Wcirc": "\u0174",
  "Wedge": "\u22c0", "Wfr": "\ud835\udd1a", "Wopf": "\ud835\udd4e", "Wscr": "\ud835\udcb2", "Xfr": "\ud835\udd1b", "Xi": "\u039e",
  "Xopf": "\ud835\udd4f", "Xscr": "\ud835\udcb3", "YAcy": "\u042f", "YIcy": "\u0407", "YUcy": "\u042e", "Yacute": "\u00dd",
  "Ycirc": "\u0176", "Ycy": "\u042b", "Yfr": "\ud835\udd1c", "Yopf": "\ud835\udd50", "Yscr": "\ud835\udcb4", "Yuml": "\u0178",
  "ZHcy": "\u0416", "Zacute": "\u0179", "Zcaron": "\u017d", "Zcy": "\u0417", "Zdot": "\u017b", "ZeroWidthSpace": "\u200b",
  "Zeta": "\u0396", "Zfr": "\u2128", "Zopf": "\u2124", "Zscr": "\ud835\udcb5", "aacute": "\u00e1", "abreve": "\u0103",
  "ac": "\u223e", "acE": "\u223e\u0333", "acd": "\u223f", "acirc": "\u00e2", "acute": "\u00b4", "acy": "\u0430",
  "aelig": "\u00e6", "af": "\u2061", "afr": "\ud835\udd1e", "agrave": "\u00e0", "alefsym": "\u2135", "aleph": "\u2135",
  "alpha": "\u03b1", "amacr": "\u0101", "amalg": "\u2a3f", "amp": "&", "and": "\u2227", "andand": "\u2a55",
  "andd": "\u2a5c", "andslope": "\u2a58", "andv": "\u2a5a", "ang": "\u2220", "ange": "\u29a4", "angle": "\u2220",
  "angmsd": "\u2221", "angmsdaa": "\u29a8", "angmsdab": "\u29a9", "angmsdac": "\u29aa", "angmsdad": "\u29ab", "angmsdae": "\u29ac",
  "angmsdaf": "\u29ad", "angmsdag": "\u29ae", "angmsdah": "\u29af", "angrt": "\u221f", "angrtvb": "\u22be", "angrtvbd": "\u299d",
  "angsph": "\u2222", "angst": "\u00c5", "angzarr": "\u237c", "aogon": "\u0105", "aopf": "\ud835\udd52", "ap": "\u2248",
  "apE": "\u2a70", "apacir": "\u2a6f", "ape": "\u224a", "apid": "\u224b", "apos": "'", "approx": "\u2248",
  "approxeq": "\u224a", "aring": "\u00e5", "ascr": "\ud835\udcb6", "ast": "*", "asymp": "\u2248", "asympeq": "\u224d",
  "atilde": "\u00e3", "auml": "\u00e4", "awconint": "\u2233", "awint": "\u2a11", "bNot": "\u2aed", "backcong": "\u224c",
  "backepsilon": "\u03f6", "backprime": "\u2035", "backsim": "\u223d", "backsimeq": "\u22cd", "barvee": "\u22bd", "barwed": "\u2305",
  "barwedge": "\u2305", "bbrk": "\u23b5", "bbrktbrk": "\u23b6", "bcong": "\u224c", "bcy": "\u0431", "bdquo": "\u201e",
  "becaus": "\u2235", "because": "\u2235", "bemptyv": "\u29b0", "bepsi": "\u03f6", "bernou": "\u212c", "beta": "\u03b2",
  "beth": "\u2136", "between": "\u226c", "bfr": "\ud835\udd1f", "bigcap": "\u22c2", "bigcirc": "\u25ef", "bigcup": "\u22c3",
  "bigodot": "\u2a00", "bigoplus": "\u2a01", "bigotimes": "\u2a02", "bigsqcup": "\u2a06", "bigstar": "\u2605", "bigtriangledown": "\u25bd",
  "bigtriangleup": "\u25b3", "biguplus": "\u2a04", "bigvee": "\u22c1", "bigwedge": "\u22c0", "bkarow": "\u290d", "blacklozenge": "\u29eb",
  "blacksquare": "\u25aa", "blacktriangle": "\u25b4", "blacktriangledown": "\u25be", "blacktriangleleft": "\u25c2", "blacktriangleright": "\u25b8", "blank": "\u2423",
  "blk12": "\u2592", "blk14": "\u2591", "blk34": "\u2593", "block": "\u2588", "bne": "=\u20e5", "bnequiv": "\u2261\u20e5",
  "bnot": "\u2310", "bopf": "\ud835\udd53", "bot": "\u22a5", "bottom": "\u22a5", "bowtie": "\u22c8", "boxDL": "\u2557",
  "boxDR": "\u2554", "boxDl": "\u2556", "boxDr": "\u2553", "boxH": "\u2550", "boxHD": "\u2566", "boxHU": "\u2569",
  "boxHd": "\u2564", "boxHu": "\u2567", "boxUL": "\u255d", "boxUR": "\u255a", "boxUl": "\u255c", "boxUr": "\u2559",
  "boxV": "\u2551", "boxVH": "\u256c", "boxVL": "\u2563", "boxVR": "\u2560", "boxVh": "\u256b", "boxVl": "\u2562",
  "boxVr": "\u255f", "boxbox": "\u29c9", "boxdL": "\u2555", "boxdR": "\u2552", "boxdl": "\u2510", "boxdr": "\u250c",
  "boxh": "\u2500", "boxhD": "\u2565", "boxhU": "\u2568", "boxhd": "\u252c", "boxhu": "\u2534", "boxminus": "\u229f",
  "boxplus": "\u229e", "boxtimes": "\u22a0", "boxuL": "\u255b", "boxuR": "\u2558", "boxul": "\u2518", "boxur": "\u2514",
  "boxv": "\u2502", "boxvH": "\u256a", "boxvL": "\u2561", "boxvR": "\u255e", "boxvh": "\u253c", "boxvl": "\u2524",
  "boxvr": "\u251c", "bprime": "\u2035", "breve": "\u02d8", "brvbar": "\u00a6", "bscr": "\ud835\udcb7", "bsemi": "\u204f",
  "bsim": "\u223d", "bsime": "\u22cd", "bsol": "\\", "bsolb": "\u29c5", "bsolhsub": "\u27c8", "bull": "\u2022",
  "bullet": "\u2022", "bump": "\u224e", "bumpE": "\u2aae", "bumpe": "\u224f", "bumpeq": "\u224f", "cacute": "\u0107",
  "cap": "\u2229", "capand": "\u2a44", "capbrcup": "\u2a49", "capcap": "\u2a4b", "capcup": "\u2a47", "capdot": "\u2a40",
  "caps": "\u2229\ufe00", "caret": "\u2041", "caron": "\u02c7", "ccaps": "\u2a4d", "ccaron": "\u010d", "ccedil": "\u00e7",
  "ccirc": "\u0109", "ccups": "\u2a4c", "ccupssm": "\u2a50", "cdot": "\u010b", "cedil": "\u00b8", "cemptyv": "\u29b2",
  "cent": "\u00a2", "centerdot": "\u00b7", "cfr": "\ud835\udd20", "chcy": "\u0447", "check": "\u2713", "checkmark": "\u2713",
  "chi": "\u03c7", "cir": "\u25cb", "cirE": "\u29c3", "circ": "\u02c6", "circeq": "\u2257", "circlearrowleft": "\u21ba",
  "circlearrowright": "\u21bb", "circledR": "\u00ae", "circledS": "\u24c8", "circledast": "\u229b", "circledcirc": "\u229a", "circleddash": "\u229d",
  "cire": "\u2257", "cirfnint": "\u2a10", "cirmid": "\u2aef", "cirscir": "\u29c2", "clubs": "\u2663", "clubsuit": "\u2663",
  "colon": ":", "colone": "\u2254", "coloneq": "\u2254", "comma": ",", "commat": "@", "comp": "\u2201",
  "compfn": "\u2218", "complement": "\u2201", "complexes": "\u2102", "cong": "\u2245", "congdot": "\u2a6d", "conint": "\u222e",
  "copf": "\ud835\udd54", "coprod": "\u2210", "copy": "\u00a9", "copysr": "\u2117", "crarr": "\u21b5", "cross": "\u2717",
  "cscr": "\ud835\udcb8", "csub": "\u2acf", "csube": "\u2ad1", "csup": "\u2ad0", "csupe": "\u2ad2", "ctdot": "\u22ef",
  "cudarrl": "\u2938", "cudarrr": "\u2935", "cuepr": "\u22de", "cuesc": "\u22df", "cularr": "\u21b6", "cularrp": "\u293d",
  "cup": "\u222a", "cupbrcap": "\u2a48", "cupcap": "\u2a46", "cupcup": "\u2a4a", "cupdot": "\u228d", "cupor": "\u2a45",
  "cups": "\u222a\ufe00", "curarr": "\u21b7", "curarrm": "\u293c", "curlyeqprec": "\u22de", "curlyeqsucc": "\u22df", "curlyvee": "\u22ce",
  "curlywedge": "\u22cf", "curren": "\u00a4", "curvearrowleft": "\u21b6", "curvearrowright": "\u21b7", "cuvee": "\u22ce", "cuwed": "\u22cf",
  "cwconint": "\u2232", "cwint": "\u2231", "cylcty": "\u232d", "dArr": "\u21d3", "dHar": "\u2965", "dagger": "\u2020",
  "daleth": "\u2138", "darr": "\u2193", "dash": "\u2010", "dashv": "\u22a3", "dbkarow": "\u290f", "dblac": "\u02dd",
  "dcaron": "\u010f", "dcy": "\u0434", "dd": "\u2146", "ddagger": "\u2021", "ddarr": "\u21ca", "ddotseq": "\u2a77",
  "deg": "\u00b0", "delta": "\u03b4", "demptyv": "\u29b1", "dfisht": "\u297f", "dfr": "\ud835\udd21", "dharl": "\u21c3",
  "dharr": "\u21c2", "diam": "\u22c4", "diamond": "\u22c4", "diamondsuit": "\u2666", "diams": "\u2666", "die": "\u00a8",
  "digamma": "\u03dd", "disin": "\u22f2", "div": "\u00f7", "divide": "\u00f7", "divideontimes": "\u22c7", "divonx": "\u22c7",
  "djcy": "\u0452", "dlcorn": "\u231e", "dlcrop": "\u230d", "dollar": "$", "dopf": "\ud835\udd55", "dot": "\u02d9",
  "doteq": "\u2250", "doteqdot": "\u2251", "dotminus": "\u2238", "dotplus": "\u2214", "dotsquare": "\u22a1", "doublebarwedge": "\u2306",
  "downarrow": "\u2193", "downdownarrows": "\u21ca", "downharpoonleft": "\u21c3", "downharpoonright": "\u21c2", "drbkarow": "\u2910", "drcorn": "\u231f",
  "drcrop": "\u230c", "dscr": "\ud835\udcb9", "dscy": "\u0455", "dsol": "\u29f6", "dstrok": "\u0111", "dtdot": "\u22f1",
  "dtri": "\u25bf", "dtrif": "\u25be", "duarr": "\u21f5", "duhar": "\u296f", "dwangle": "\u29a6", "dzcy": "\u045f",
  "dzigrarr": "\u27ff", "eDDot": "\u2a77", "eDot": "\u2251", "eacute": "\u00e9", "easter": "\u2a6e", "ecaron": "\u011b",
  "ecir": "\u2256", "ecirc": "\u00ea", "ecolon": "\u2255", "ecy": "\u044d", "edot": "\u0117", "ee": "\u2147",
  "efDot": "\u2252", "efr": "\ud835\udd22", "eg": "\u2a9a", "egrave": "\u00e8", "egs": "\u2a96", "egsdot": "\u2a98",
  "el": "\u2a99", "elinters": "\u23e7", "ell": "\u2113", "els": "\u2a95", "elsdot": "\u2a97", "emacr": "\u0113",
  "empty": "\u2205", "emptyset": "\u2205", "emptyv": "\u2205", "emsp": "\u2003", "emsp13": "\u2004", "emsp14": "\u2005",
  "eng": "\u014b", "ensp": "\u2002", "eogon": "\u0119", "eopf": "\ud835\udd56", "epar": "\u22d5", "eparsl": "\u29e3",
  "eplus": "\u2a71", "epsi": "\u03b5", "epsilon": "\u03b5", "epsiv": "\u03f5", "eqcirc": "\u2256", "eqcolon": "\u2255",
  "eqsim": "\u2242", "eqslantgtr": "\u2a96", "eqslantless": "\u2a95", "equals": "=", "equest": "\u225f", "equiv": "\u2261",
  "equivDD": "\u2a78", "eqvparsl": "\u29e5", "erDot": "\u2253", "erarr": "\u2971", "escr": "\u212f", "esdot": "\u2250",
  "esim": "\u2242", "eta": "\u03b7", "eth": "\u00f0", "euml": "\u00eb", "euro": "\u20ac", "excl": "!",
  "exist": "\u2203", "expectation": "\u2130", "exponentiale": "\u2147", "fallingdotseq": "\u2252", "fcy": "\u0444", "female": "\u2640",
  "ffilig": "\ufb03", "fflig": "\ufb00", "ffllig": "\ufb04", "ffr": "\ud835\udd23", "filig": "\ufb01", "fjlig": "fj",
  "flat": "\u266d", "fllig": "\ufb02", "fltns": "\u25b1", "fnof": "\u0192", "fopf": "\ud835\udd57", "forall": "\u2200",
  "fork": "\u22d4", "forkv": "\u2ad9", "fpartint": "\u2a0d", "frac12": "\u00bd", "frac13": "\u2153", "frac14": "\u00bc",
  "frac15": "\u2155", "frac16": "\u2159", "frac18": "\u215b", "frac23": "\u2154", "frac25": "\u2156", "frac34": "\u00be",
  "frac35": "\u2157", "frac38": "\u215c", "frac45": "\u2158", "frac56": "\u215a", "frac58": "\u215d", "frac78": "\u215e",
  "frasl": "\u2044", "frown": "\u2322", "fscr": "\ud835\udcbb", "gE": "\u2267", "gEl": "\u2a8c", "gacute": "\u01f5",
  "gamma": "\u03b3", "gammad": "\u03dd", "gap": "\u2a86", "gbreve": "\u011f", "gcirc": "\u011d", "gcy": "\u0433",
  "gdot": "\u0121", "ge": "\u2265", "gel": "\u22db", "geq": "\u2265", "geqq": "\u2267", "geqslant": "\u2a7e",
  "ges": "\u2a7e", "gescc": "\u2aa9", "gesdot": "\u2a80", "gesdoto": "\u2a82", "gesdotol": "\u2a84", "gesl": "\u22db\ufe00",
  "gesles": "\u2a94", "gfr": "\ud835\udd24", "gg": "\u226b", "ggg": "\u22d9", "gimel": "\u2137", "gjcy": "\u0453",
  "gl": "\u2277", "glE": "\u2a92", "gla": "\u2aa5", "glj": "\u2aa4", "gnE": "\u2269", "gnap": "\u2a8a",
  "gnapprox": "\u2a8a", "gne": "\u2a88", "gneq": "\u2a88", "gneqq": "\u2269", "gnsim": "\u22e7", "gopf": "\ud835\udd58",
  "grave": "`", "gscr": "\u210a", "gsim": "\u2273", "gsime": "\u2a8e", "gsiml": "\u2a90", "gt": ">",
  "gtcc": "\u2aa7", "gtcir": "\u2a7a", "gtdot": "\u22d7", "gtlPar": "\u2995", "gtquest": "\u2a7c", "gtrapprox": "\u2a86",
  "gtrarr": "\u2978", "gtrdot": "\u22d7", "gtreqless": "\u22db", "gtreqqless": "\u2a8c", "gtrless": "\u2277", "gtrsim": "\u2273",
  "gvertneqq": "\u2269\ufe00", "gvnE": "\u2269\ufe00", "hArr": "\u21d4", "hairsp": "\u200a", "half": "\u00bd", "hamilt": "\u210b",
  "hardcy": "\u044a", "harr": "\u2194", "harrcir": "\u2948", "harrw": "\u21ad", "hbar": "\u210f", "hcirc": "\u0125",
  "hearts": "\u2665", "heartsuit": "\u2665", "hellip": "\u2026", "hercon": "\u22b9", "hfr": "\ud835\udd25", "hksearow": "\u2925",
  "hkswarow": "\u2926", "hoarr": "\u21ff", "homtht": "\u223b", "hookleftarrow": "\u21a9", "hookrightarrow": "\u21aa", "hopf": "\ud835\udd59",
  "horbar": "\u2015", "hscr": "\ud835\udcbd", "hslash": "\u210f", "hstrok": "\u0127", "hybull": "\u2043", "hyphen": "\u2010",
  "iacute": "\u00ed", "ic": "\u2063", "icirc": "\u00ee", "icy": "\u0438", "iecy": "\u0435", "iexcl": "\u00a1",
  "iff": "\u21d4", "ifr": "\ud835\udd26", "igrave": "\u00ec", "ii": "\u2148", "iiiint": "\u2a0c", "iiint": "\u222d",
  "iinfin": "\u29dc", "iiota": "\u2129", "ijlig": "\u0133", "imacr": "\u012b", "image": "\u2111", "imagline": "\u2110",
  "imagpart": "\u2111", "imath": "\u0131", "imof": "\u22b7", "imped": "\u01b5", "in": "\u2208", "incare": "\u2105",
  "infin": "\u221e", "infintie": "\u29dd", "inodot": "\u0131", "int": "\u222b", "intcal": "\u22ba", "integers": "\u2124",
  "intercal": "\u22ba", "intlarhk": "\u2a17", "intprod": "\u2a3c", "iocy": "\u0451", "iogon": "\u012f", "iopf": "\ud835\udd5a",
  "iota": "\u03b9", "iprod": "\u2a3c", "iquest": "\u00bf", "iscr": "\ud835\udcbe", "isin": "\u2208", "isinE": "\u22f9",
  "isindot": "\u22f5", "isins": "\u22f4", "isinsv": "\u22f3", "isinv": "\u2208", "it": "\u2062", "itilde": "\u0129",
  "iukcy": "\u0456", "iuml": "\u00ef", "jcirc": "\u0135", "jcy": "\u0439", "jfr": "\ud835\udd27", "jmath": "\u0237",
  "jopf": "\ud835\udd5b", "jscr": "\ud835\udcbf", "jsercy": "\u0458", "jukcy": "\u0454", "kappa": "\u03ba", "kappav": "\u03f0",
  "kcedil": "\u0137", "kcy": "\u043a", "kfr": "\ud835\udd28", "kgreen": "\u0138", "khcy": "\u0445", "kjcy": "\u045c",
  "kopf": "\ud835\udd5c", "kscr": "\ud835\udcc0", "lAarr": "\u21da", "lArr": "\u21d0", "lAtail": "\u291b", "lBarr": "\u290e",
  "lE": "\u2266", "lEg": "\u2a8b", "lHar": "\u2962", "lacute": "\u013a", "laemptyv": "\u29b4", "lagran": "\u2112",
  "lambda": "\u03bb", "lang": "\u27e8", "langd": "\u2991", "langle": "\u27e8", "lap": "\u2a85", "laquo": "\u00ab",
  "larr": "\u2190", "larrb": "\u21e4", "larrbfs": "\u291f", "larrfs": "\u291d", "larrhk": "\u21a9", "larrlp": "\u21ab",
  "larrpl": "\u2939", "larrsim": "\u2973", "larrtl": "\u21a2", "lat": "\u2aab", "latail": "\u2919", "late": "\u2aad",
  "lates": "\u2aad\ufe00", "lbarr": "\u290c", "lbbrk": "\u2772", "lbrace": "{", "lbrack": "[", "lbrke": "\u298b",
  "lbrksld": "\u298f", "lbrkslu": "\u298d", "lcaron": "\u013e", "lcedil": "\u013c", "lceil": "\u2308", "lcub": "{",
  "lcy": "\u043b", "ldca": "\u2936", "ldquo": "\u201c", "ldquor": "\u201e", "ldrdhar": "\u2967", "ldrushar": "\u294b",
  "ldsh": "\u21b2", "le": "\u2264", "leftarrow": "\u2190", "leftarrowtail": "\u21a2", "leftharpoondown": "\u21bd", "leftharpoonup": "\u21bc",
  "leftleftarrows": "\u21c7", "leftrightarrow": "\u2194", "leftrightarrows": "\u21c6", "leftrightharpoons": "\u21cb", "leftrightsquigarrow": "\u21ad", "leftthreetimes": "\u22cb",
  "leg": "\u22da", "leq": "\u2264", "leqq": "\u2266", "leqslant": "\u2a7d", "les": "\u2a7d", "lescc": "\u2aa8",
  "lesdot": "\u2a7f", "lesdoto": "\u2a81", "lesdotor": "\u2a83", "lesg": "\u22da\ufe00", "lesges": "\u2a93", "lessapprox": "\u2a85",
  "lessdot": "\u22d6", "lesseqgtr": "\u22da", "lesseqqgtr": "\u2a8b", "lessgtr": "\u2276", "lesssim": "\u2272", "lfisht": "\u297c",
  "lfloor": "\u230a", "lfr": "\ud835\udd29", "lg": "\u2276", "lgE": "\u2a91", "lhard": "\u21bd", "lharu": "\u21bc",
  "lharul": "\u296a", "lhblk": "\u2584", "ljcy": "\u0459", "ll": "\u226a", "llarr": "\u21c7", "llcorner": "\u231e",
  "llhard": "\u296b", "lltri": "\u25fa", "lmidot": "\u0140", "lmoust": "\u23b0", "lmoustache": "\u23b0", "lnE": "\u2268",
  "lnap": "\u2a89", "lnapprox": "\u2a89", "lne": "\u2a87", "lneq": "\u2a87", "lneqq": "\u2268", "lnsim": "\u22e6",
  "loang": "\u27ec", "loarr": "\u21fd", "lobrk": "\u27e6", "longleftarrow": "\u27f5", "longleftrightarrow": "\u27f7", "longmapsto": "\u27fc",
  "longrightarrow": "\u27f6", "looparrowleft": "\u21ab", "looparrowright": "\u21ac", "lopar": "\u2985", "lopf": "\ud835\udd5d", "loplus": "\u2a2d",
  "lotimes": "\u2a34", "lowast": "\u2217", "lowbar": "_", "loz": "\u25ca", "lozenge": "\u25ca", "lozf": "\u29eb",
  "lpar": "(", "lparlt": "\u2993", "lrarr": "\u21c6", "lrcorner": "\u231f", "lrhar": "\u21cb", "lrhard": "\u296d",
  "lrm": "\u200e", "lrtri": "\u22bf", "lsaquo": "\u2039", "lscr": "\ud835\udcc1", "lsh": "\u21b0", "lsim": "\u2272",
  "lsime": "\u2a8d", "lsimg": "\u2a8f", "lsqb": "[", "lsquo": "\u2018", "lsquor": "\u201a", "lstrok": "\u0142",
  "lt": "<", "ltcc": "\u2aa6", "ltcir": "\u2a79", "ltdot": "\u22d6", "lthree": "\u22cb", "ltimes": "\u22c9",
  "ltlarr": "\u2976", "ltquest": "\u2a7b", "ltrPar": "\u2996", "ltri": "\u25c3", "ltrie": "\u22b4", "ltrif": "\u25c2",
  "lurdshar": "\u294a", "luruhar": "\u2966", "lvertneqq": "\u2268\ufe00", "lvnE": "\u2268\ufe00", "mDDot": "\u223a", "macr": "\u00af",
  "male": "\u2642", "malt": "\u2720", "maltese": "\u2720", "map": "\u21a6", "mapsto": "\u21a6", "mapstodown": "\u21a7",
  "mapstoleft": "\u21a4", "mapstoup": "\u21a5", "marker": "\u25ae", "mcomma": "\u2a29", "mcy": "\u043c", "mdash": "\u2014",
  "measuredangle": "\u2221", "mfr": "\ud835\udd2a", "mho": "\u2127", "micro": "\u00b5", "mid": "\u2223", "midast": "*",
  "midcir": "\u2af0", "middot": "\u00b7", "minus": "\u2212", "minusb": "\u229f", "minusd": "\u2238", "minusdu": "\u2a2a",
  "mlcp": "\u2adb", "mldr": "\u2026", "mnplus": "\u2213", "models": "\u22a7", "mopf": "\ud835\udd5e", "mp": "\u2213",
  "mscr": "\ud835\udcc2", "mstpos": "\u223e", "mu": "\u03bc", "multimap": "\u22b8", "mumap": "\u22b8", "nGg": "\u22d9\u0338",
  "nGt": "\u226b\u20d2", "nGtv": "\u226b\u0338", "nLeftarrow": "\u21cd", "nLeftrightarrow": "\u21ce", "nLl": "\u22d8\u0338", "nLt": "\u226a\u20d2",
  "nLtv": "\u226a\u0338", "nRightarrow": "\u21cf", "nVDash": "\u22af", "nVdash": "\u22ae", "nabla": "\u2207", "nacute": "\u0144",
  "nang": "\u2220\u20d2", "nap": "\u2249", "napE": "\u2a70\u0338", "napid": "\u224b\u0338", "napos": "\u0149", "napprox": "\u2249",
  "natur": "\u266e", "natural": "\u266e", "naturals": "\u2115", "nbsp": "\u00a0", "nbump": "\u224e\u0338", "nbumpe": "\u224f\u0338",
  "ncap": "\u2a43", "ncaron": "\u0148", "ncedil": "\u0146", "ncong": "\u2247", "ncongdot": "\u2a6d\u0338", "ncup": "\u2a42",
  "ncy": "\u043d", "ndash": "\u2013", "ne": "\u2260", "neArr": "\u21d7", "nearhk": "\u2924", "nearr": "\u2197",
  "nearrow": "\u2197", "nedot": "\u2250\u0338", "nequiv": "\u2262", "nesear": "\u2928", "nesim": "\u2242\u0338", "nexist": "\u2204",
  "nexists": "\u2204", "nfr": "\ud835\udd2b", "ngE": "\u2267\u0338", "nge": "\u2271", "ngeq": "\u2271", "ngeqq": "\u2267\u0338",
  "ngeqslant": "\u2a7e\u0338", "nges": "\u2a7e\u0338", "ngsim": "\u2275", "ngt": "\u226f", "ngtr": "\u226f", "nhArr": "\u21ce",
  "nharr": "\u21ae", "nhpar": "\u2af2", "ni": "\u220b", "nis": "\u22fc", "nisd": "\u22fa", "niv": "\u220b",
  "njcy": "\u045a", "nlArr": "\u21cd", "nlE": "\u2266\u0338", "nlarr": "\u219a", "nldr": "\u2025", "nle": "\u2270",
  "nleftarrow": "\u219a", "nleftrightarrow": "\u21ae", "nleq": "\u2270", "nleqq": "\u2266\u0338", "nleqslant": "\u2a7d\u0338", "nles": "\u2a7d\u0338",
  "nless": "\u226e", "nlsim": "\u2274", "nlt": "\u226e", "nltri": "\u22ea", "nltrie": "\u22ec", "nmid": "\u2224",
  "nopf": "\ud835\udd5f", "not": "\u00ac", "notin": "\u2209", "notinE": "\u22f9\u0338", "notindot": "\u22f5\u0338", "notinva": "\u2209",
  "notinvb": "\u22f7", "notinvc": "\u22f6", "notni": "\u220c", "notniva": "\u220c", "notnivb": "\u22fe", "notnivc": "\u22fd",
  "npar": "\u2226", "nparallel": "\u2226", "nparsl": "\u2afd\u20e5", "npart": "\u2202\u0338", "npolint": "\u2a14", "npr": "\u2280",
  "nprcue": "\u22e0", "npre": "\u2aaf\u0338", "nprec": "\u2280", "npreceq": "\u2aaf\u0338", "nrArr": "\u21cf", "nrarr": "\u219b",
  "nrarrc": "\u2933\u0338", "nrarrw": "\u219d\u0338", "nrightarrow": "\u219b", "nrtri": "\u22eb", "nrtrie": "\u22ed", "nsc": "\u2281",
  "nsccue": "\u22e1", "nsce": "\u2ab0\u0338", "nscr": "\ud835\udcc3", "nshortmid": "\u2224", "nshortparallel": "\u2226", "nsim": "\u2241",
  "nsime": "\u2244", "nsimeq": "\u2244", "nsmid": "\u2224", "nspar": "\u2226", "nsqsube": "\u22e2", "nsqsupe": "\u22e3",
  "nsub": "\u2284", "nsubE": "\u2ac5\u0338", "nsube": "\u2288", "nsubset": "\u2282\u20d2", "nsubseteq": "\u2288", "nsubseteqq": "\u2ac5\u0338",
  "nsucc": "\u2281", "nsucceq": "\u2ab0\u0338", "nsup": "\u2285", "nsupE": "\u2ac6\u0338", "nsupe": "\u2289", "nsupset": "\u2283\u20d2",
  "nsupseteq": "\u2289", "nsupseteqq": "\u2ac6\u0338", "ntgl": "\u2279", "ntilde": "\u00f1", "ntlg": "\u2278", "ntriangleleft": "\u22ea",
  "ntrianglelefteq": "\u22ec", "ntriangleright": "\u22eb", "ntrianglerighteq": "\u22ed", "nu": "\u03bd", "num": "#", "numero": "\u2116",
  "numsp": "\u2007", "nvDash": "\u22ad", "nvHarr": "\u2904", "nvap": "\u224d\u20d2", "nvdash": "\u22ac", "nvge": "\u2265\u20d2",
  "nvgt": ">\u20d2", "nvinfin": "\u29de", "nvlArr": "\u2902", "nvle": "\u2264\u20d2", "nvlt": "<\u20d2", "nvltrie": "\u22b4\u20d2",
  "nvrArr": "\u2903", "nvrtrie": "\u22b5\u20d2", "nvsim": "\u223c\u20d2", "nwArr": "\u21d6", "nwarhk": "\u2923", "nwarr": "\u2196",
  "nwarrow": "\u2196", "nwnear": "\u2927", "oS": "\u24c8", "oacute": "\u00f3", "oast": "\u229b", "ocir": "\u229a",
  "ocirc": "\u00f4", "ocy": "\u043e", "odash": "\u229d", "odblac": "\u0151", "odiv": "\u2a38", "odot": "\u2299",
  "odsold": "\u29bc", "oelig": "\u0153", "ofcir": "\u29bf", "ofr": "\ud835\udd2c", "ogon": "\u02db", "ograve": "\u00f2",
  "ogt": "\u29c1", "ohbar": "\u29b5", "ohm": "\u03a9", "oint": "\u222e", "olarr": "\u21ba", "olcir": "\u29be",
  "olcross": "\u29bb", "oline": "\u203e", "olt": "\u29c0", "omacr": "\u014d", "omega": "\u03c9", "omicron": "\u03bf",
  "omid": "\u29b6", "ominus": "\u2296", "oopf": "\ud835\udd60", "opar": "\u29b7", "operp": "\u29b9", "oplus": "\u2295",
  "or": "\u2228", "orarr": "\u21bb", "ord": "\u2a5d", "order": "\u2134", "orderof": "\u2134", "ordf": "\u00aa",
  "ordm": "\u00ba", "origof": "\u22b6", "oror": "\u2a56", "orslope": "\u2a57", "orv": "\u2a5b", "oscr": "\u2134",
  "oslash": "\u00f8", "osol": "\u2298", "otilde": "\u00f5", "otimes": "\u2297", "otimesas": "\u2a36", "ouml": "\u00f6",
  "ovbar": "\u233d", "par": "\u2225", "para": "\u00b6", "parallel": "\u2225", "parsim": "\u2af3", "parsl": "\u2afd",
  "part": "\u2202", "pcy": "\u043f", "percnt": "%", "period": ".", "permil": "\u2030", "perp": "\u22a5",
  "pertenk": "\u2031", "pfr": "\ud835\udd2d", "phi": "\u03c6", "phiv": "\u03d5", "phmmat": "\u2133", "phone": "\u260e",
  "pi": "\u03c0", "pitchfork": "\u22d4", "piv": "\u03d6", "planck": "\u210f", "planckh": "\u210e", "plankv": "\u210f",
  "plus": "+", "plusacir": "\u2a23", "plusb": "\u229e", "pluscir": "\u2a22", "plusdo": "\u2214", "plusdu": "\u2a25",
  "pluse": "\u2a72", "plusmn": "\u00b1", "plussim": "\u2a26", "plustwo": "\u2a27", "pm": "\u00b1", "pointint": "\u2a15",
  "popf": "\ud835\udd61", "pound": "\u00a3", "pr": "\u227a", "prE": "\u2ab3", "prap": "\u2ab7", "prcue": "\u227c",
  "pre": "\u2aaf", "prec": "\u227a", "precapprox": "\u2ab7", "preccurlyeq": "\u227c", "preceq": "\u2aaf", "precnapprox": "\u2ab9",
  "precneqq": "\u2ab5", "precnsim": "\u22e8", "precsim": "\u227e", "prime": "\u2032", "primes": "\u2119", "prnE": "\u2ab5",
  "prnap": "\u2ab9", "prnsim": "\u22e8", "prod": "\u220f", "profalar": "\u232e", "profline": "\u2312", "profsurf": "\u2313",
  "prop": "\u221d", "propto": "\u221d", "prsim": "\u227e", "prurel": "\u22b0", "pscr": "\ud835\udcc5", "psi": "\u03c8",
  "puncsp": "\u2008", "qfr": "\ud835\udd2e", "qint": "\u2a0c", "qopf": "\ud835\udd62", "qprime": "\u2057", "qscr": "\ud835\udcc6",
  "quaternions": "\u210d", "quatint": "\u2a16", "quest": "?", "questeq": "\u225f", "quot": "\"", "rAarr": "\u21db",
  "rArr": "\u21d2", "rAtail": "\u291c", "rBarr": "\u290f", "rHar": "\u2964", "race": "\u223d\u0331", "racute": "\u0155",
  "radic": "\u221a", "raemptyv": "\u29b3", "rang": "\u27e9", "rangd": "\u2992", "range": "\u29a5", "rangle": "\u27e9",
  "raquo": "\u00bb", "rarr": "\u2192", "rarrap": "\u2975", "rarrb": "\u21e5", "rarrbfs": "\u2920", "rarrc": "\u2933",
  "rarrfs": "\u291e", "rarrhk": "\u21aa", "rarrlp": "\u21ac", "rarrpl": "\u2945", "rarrsim": "\u2974", "rarrtl": "\u21a3",
  "rarrw": "\u219d", "ratail": "\u291a", "ratio": "\u2236", "rationals": "\u211a", "rbarr": "\u290d", "rbbrk": "\u2773",
  "rbrace": "}", "rbrack": "]", "rbrke": "\u298c", "rbrksld": "\u298e", "rbrkslu": "\u2990", "rcaron": "\u0159",
  "rcedil": "\u0157", "rceil": "\u2309", "rcub": "}", "rcy": "\u0440", "rdca": "\u2937", "rdldhar": "\u2969",
  "rdquo": "\u201d", "rdquor": "\u201d", "rdsh": "\u21b3", "real": "\u211c", "realine": "\u211b", "realpart": "\u211c",
  "reals": "\u211d", "rect": "\u25ad", "reg": "\u00ae", "rfisht": "\u297d", "rfloor": "\u230b", "rfr": "\ud835\udd2f",
  "rhard": "\u21c1", "rharu": "\u21c0", "rharul": "\u296c", "rho": "\u03c1", "rhov": "\u03f1", "rightarrow": "\u2192",
  "rightarrowtail": "\u21a3", "rightharpoondown": "\u21c1", "rightharpoonup": "\u21c0", "rightleftarrows": "\u21c4", "rightleftharpoons": "\u21cc", "rightrightarrows": "\u21c9",
  "rightsquigarrow": "\u219d", "rightthreetimes": "\u22cc", "ring": "\u02da", "risingdotseq": "\u2253", "rlarr": "\u21c4", "rlhar": "\u21cc",
  "rlm": "\u200f", "rmoust": "\u23b1", "rmoustache": "\u23b1", "rnmid": "\u2aee", "roang": "\u27ed", "roarr": "\u21fe",
  "robrk": "\u27e7", "ropar": "\u2986", "ropf": "\ud835\udd63", "roplus": "\u2a2e", "rotimes": "\u2a35", "rpar": ")",
  "rpargt": "\u2994", "rppolint": "\u2a12", "rrarr": "\u21c9", "rsaquo": "\u203a", "rscr": "\ud835\udcc7", "rsh": "\u21b1",
  "rsqb": "]", "rsquo": "\u2019", "rsquor": "\u2019", "rthree": "\u22cc", "rtimes": "\u22ca", "rtri": "\u25b9",
  "rtrie": "\u22b5", "rtrif": "\u25b8", "rtriltri": "\u29ce", "ruluhar": "\u2968", "rx": "\u211e", "sacute": "\u015b",
  "sbquo": "\u201a", "sc": "\u227b", "scE": "\u2ab4", "scap": "\u2ab8", "scaron": "\u0161", "sccue": "\u227d",
  "sce": "\u2ab0", "scedil": "\u015f", "scirc": "\u015d", "scnE": "\u2ab6", "scnap": "\u2aba", "scnsim": "\u22e9",
  "scpolint": "\u2a13", "scsim": "\u227f", "scy": "\u0441", "sdot": "\u22c5", "sdotb": "\u22a1", "sdote": "\u2a66",
  "seArr": "\u21d8", "searhk": "\u2925", "searr": "\u2198", "searrow": "\u2198", "sect": "\u00a7", "semi": ";",
  "seswar": "\u2929", "setminus": "\u2216", "setmn": "\u2216", "sext": "\u2736", "sfr": "\ud835\udd30", "sfrown": "\u2322",
  "sharp": "\u266f", "shchcy": "\u0449", "shcy": "\u0448", "shortmid": "\u2223", "shortparallel": "\u2225", "shy": "\u00ad",
  "sigma": "\u03c3", "sigmaf": "\u03c2", "sigmav": "\u03c2", "sim": "\u223c", "simdot": "\u2a6a", "sime": "\u2243",
  "simeq": "\u2243", "simg": "\u2a9e", "simgE": "\u2aa0", "siml": "\u2a9d", "simlE": "\u2a9f", "simne": "\u2246",
  "simplus": "\u2a24", "simrarr": "\u2972", "slarr": "\u2190", "smallsetminus": "\u2216", "smashp": "\u2a33", "smeparsl": "\u29e4",
  "smid": "\u2223", "smile": "\u2323", "smt": "\u2aaa", "smte": "\u2aac", "smtes": "\u2aac\ufe00", "softcy": "\u044c",
  "sol": "/", "solb": "\u29c4", "solbar": "\u233f", "sopf": "\ud835\udd64", "spades": "\u2660", "spadesuit": "\u2660",
  "spar": "\u2225", "sqcap": "\u2293", "sqcaps": "\u2293\ufe00", "sqcup": "\u2294", "sqcups": "\u2294\ufe00", "sqsub": "\u228f",
  "sqsube": "\u2291", "sqsubset": "\u228f", "sqsubseteq": "\u2291", "sqsup": "\u2290", "sqsupe": "\u2292", "sqsupset": "\u2290",
  "sqsupseteq": "\u2292", "squ": "\u25a1", "square": "\u25a1", "squarf": "\u25aa", "squf": "\u25aa", "srarr": "\u2192",
  "sscr": "\ud835\udcc8", "ssetmn": "\u2216", "ssmile": "\u2323", "sstarf": "\u22c6", "star": "\u2606", "starf": "\u2605",
  "straightepsilon": "\u03f5", "straightphi": "\u03d5", "strns": "\u00af", "sub": "\u2282", "subE": "\u2ac5", "subdot": "\u2abd",
  "sube": "\u2286", "subedot": "\u2ac3", "submult": "\u2ac1", "subnE": "\u2acb", "subne": "\u228a", "subplus": "\u2abf",
  "subrarr": "\u2979", "subset": "\u2282", "subseteq": "\u2286", "subseteqq": "\u2ac5", "subsetneq": "\u228a", "subsetneqq": "\u2acb",
  "subsim": "\u2ac7", "subsub": "\u2ad5", "subsup": "\u2ad3", "succ": "\u227b", "succapprox": "\u2ab8", "succcurlyeq": "\u227d",
  "succeq": "\u2ab0", "succnapprox": "\u2aba", "succneqq": "\u2ab6", "succnsim": "\u22e9", "succsim": "\u227f", "sum": "\u2211",
  "sung": "\u266a", "sup": "\u2283", "sup1": "\u00b9", "sup2": "\u00b2", "sup3": "\u00b3", "supE": "\u2ac6",
  "supdot": "\u2abe", "supdsub": "\u2ad8", "supe": "\u2287", "supedot": "\u2ac4", "suphsol": "\u27c9", "suphsub": "\u2ad7",
  "suplarr": "\u297b", "supmult": "\u2ac2", "supnE": "\u2acc", "supne": "\u228b", "supplus": "\u2ac0", "supset": "\u2283",
  "supseteq": "\u2287", "supseteqq": "\u2ac6", "supsetneq": "\u228b", "supsetneqq": "\u2acc", "supsim": "\u2ac8", "supsub": "\u2ad4",
  "supsup": "\u2ad6", "swArr": "\u21d9", "swarhk": "\u2926", "swarr": "\u2199", "swarrow": "\u2199", "swnwar": "\u292a",
  "szlig": "\u00df", "target": "\u2316", "tau": "\u03c4", "tbrk": "\u23b4", "tcaron": "\u0165", "tcedil": "\u0163",
  "tcy": "\u0442", "tdot": "\u20db", "telrec": "\u2315", "tfr": "\ud835\udd31", "there4": "\u2234", "therefore": "\u2234",
  "theta": "\u03b8", "thetasym": "\u03d1", "thetav": "\u03d1", "thickapprox": "\u2248", "thicksim": "\u223c", "thinsp": "\u2009",
  "thkap": "\u2248", "thksim": "\u223c", "thorn": "\u00fe", "tilde": "\u02dc", "times": "\u00d7", "timesb": "\u22a0",
  "timesbar": "\u2a31", "timesd": "\u2a30", "tint": "\u222d", "toea": "\u2928", "top": "\u22a4", "topbot": "\u2336",
  "topcir": "\u2af1", "topf": "\ud835\udd65", "topfork": "\u2ada", "tosa": "\u2929", "tprime": "\u2034", "trade": "\u2122",
  "triangle": "\u25b5", "triangledown": "\u25bf", "triangleleft": "\u25c3", "trianglelefteq": "\u22b4", "triangleq": "\u225c", "triangleright": "\u25b9",
  "trianglerighteq": "\u22b5", "tridot": "\u25ec", "trie": "\u225c", "triminus": "\u2a3a", "triplus": "\u2a39", "trisb": "\u29cd",
  "tritime": "\u2a3b", "trpezium": "\u23e2", "tscr": "\ud835\udcc9", "tscy": "\u0446", "tshcy": "\u045b", "tstrok": "\u0167",
  "twixt": "\u226c", "twoheadleftarrow": "\u219e", "twoheadrightarrow": "\u21a0", "uArr": "\u21d1", "uHar": "\u2963", "uacute": "\u00fa",
  "uarr": "\u2191", "ubrcy": "\u045e", "ubreve": "\u016d", "ucirc": "\u00fb", "ucy": "\u0443", "udarr": "\u21c5",
  "udblac": "\u0171", "udhar": "\u296e", "ufisht": "\u297e", "ufr": "\ud835\udd32", "ugrave": "\u00f9", "uharl": "\u21bf",
  "uharr": "\u21be", "uhblk": "\u2580", "ulcorn": "\u231c", "ulcorner": "\u231c", "ulcrop": "\u230f", "ultri": "\u25f8",
  "umacr": "\u016b", "uml": "\u00a8", "uogon": "\u0173", "uopf": "\ud835\udd66", "uparrow": "\u2191", "updownarrow": "\u2195",
  "upharpoonleft": "\u21bf", "upharpoonright": "\u21be", "uplus": "\u228e", "upsi": "\u03c5", "upsih": "\u03d2", "upsilon": "\u03c5",
  "upuparrows": "\u21c8", "urcorn": "\u231d", "urcorner": "\u231d", "urcrop": "\u230e", "uring": "\u016f", "urtri": "\u25f9",
  "uscr": "\ud835\udcca", "utdot": "\u22f0", "utilde": "\u0169", "utri": "\u25b5", "utrif": "\u25b4", "uuarr": "\u21c8",
  "uuml": "\u00fc", "uwangle": "\u29a7", "vArr": "\u21d5", "vBar": "\u2ae8", "vBarv": "\u2ae9", "vDash": "\u22a8",
  "vangrt": "\u299c", "varepsilon": "\u03f5", "varkappa": "\u03f0", "varnothing": "\u2205", "varphi": "\u03d5", "varpi": "\u03d6",
  "varpropto": "\u221d", "varr": "\u2195", "varrho": "\u03f1", "varsigma": "\u03c2", "varsubsetneq": "\u228a\ufe00", "varsubsetneqq": "\u2acb\ufe00",
  "varsupsetneq": "\u228b\ufe00", "varsupsetneqq": "\u2acc\ufe00", "vartheta": "\u03d1", "vartriangleleft": "\u22b2", "vartriangleright": "\u22b3", "vcy": "\u0432",
  "vdash": "\u22a2", "vee": "\u2228", "veebar": "\u22bb", "veeeq": "\u225a", "vellip": "\u22ee", "verbar": "|",
  "vert": "|", "vfr": "\ud835\udd33", "vltri": "\u22b2", "vnsub": "\u2282\u20d2", "vnsup": "\u2283\u20d2", "vopf": "\ud835\udd67",
  "vprop": "\u221d", "vrtri": "\u22b3", "vscr": "\ud835\udccb", "vsubnE": "\u2acb\ufe00", "vsubne": "\u228a\ufe00", "vsupnE": "\u2acc\ufe00",
  "vsupne": "\u228b\ufe00", "vzigzag": "\u299a", "wcirc": "\u0175", "wedbar": "\u2a5f", "wedge": "\u2227", "wedgeq": "\u2259",
  "weierp": "\u2118", "wfr": "\ud835\udd34", "wopf": "\ud835\udd68", "wp": "\u2118", "wr": "\u2240", "wreath": "\u2240",
  "wscr": "\ud835\udccc", "xcap": "\u22c2", "xcirc": "\u25ef", "xcup": "\u22c3", "xdtri": "\u25bd", "xfr": "\ud835\udd35",
  "xhArr": "\u27fa", "xharr": "\u27f7", "xi": "\u03be", "xlArr": "\u27f8", "xlarr": "\u27f5", "xmap": "\u27fc",
  "xnis": "\u22fb", "xodot": "\u2a00", "xopf": "\ud835\udd69", "xoplus": "\u2a01", "xotime": "\u2a02", "xrArr": "\u27f9",
  "xrarr": "\u27f6", "xscr": "\ud835\udccd", "xsqcup": "\u2a06", "xuplus": "\u2a04", "xutri": "\u25b3", "xvee": "\u22c1",
  "xwedge": "\u22c0", "yacute": "\u00fd", "yacy": "\u044f", "ycirc": "\u0177", "ycy": "\u044b", "yen": "\u00a5",
  "yfr": "\ud835\udd36", "yicy": "\u0457", "yopf": "\ud835\udd6a", "yscr": "\ud835\udcce", "yucy": "\u044e", "yuml": "\u00ff",
  "zacute": "\u017a", "zcaron": "\u017e", "zcy": "\u0437", "zdot": "\u017c", "zeetrf": "\u2128", "zeta": "\u03b6",
  "zfr": "\ud835\udd37", "zhcy": "\u0436", "zigrarr": "\u21dd", "zopf": "\ud835\udd6b", "zscr": "\ud835\udccf", "zwj": "\u200d",
  "zwnj": "\u200c",
});

function normalizeVisibleFragment(value, rawHtml = false) {
  if (rawHtml) value = canonicalizeLegacyHtmlReferences(value, () => true);
  // Recognize raw Markdown before decoding; entities cannot create syntax.
  const visible = rawHtml ? value : activeMarkdownEmphasis(value);
  return visible.replace(rawHtml ? /&#(x[0-9a-f]+|[0-9]+);?|&([A-Za-z][A-Za-z0-9]*);/gi : /&#(x[0-9a-f]+|[0-9]+);|&([A-Za-z][A-Za-z0-9]*);/gi, (entity, digits, name) => {
    if (name) return Object.hasOwn(HTML_NAMED_ENTITIES, name) ? HTML_NAMED_ENTITIES[name] : entity;
    const point = digits[0].toLowerCase() === "x" ? parseInt(digits.slice(1), 16) : Number(digits);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  }).replace(/\p{Default_Ignorable_Code_Point}/gu, "").replace(/[^\S\r\n]/g, " ");
}

// Mask only explicitly absent finding-subject state assertions; preserve other state evidence.
function maskAbsentFindingStates(text) {
  return text.replace(/\b(?:no|zero|0) +(?:(?:code|security|blocking|critical|high|medium|low|major|minor|unresolved|open|new|resolved|fixed|addressed|cleared|removed|closed|eliminated) +)*(?:issues?|findings?|problems?|bugs?|flaws?|defects?|regressions?|vulnerabilit(?:y|ies)) +(?:(?:is|are|was|were|remain|remains|remained) +)*(?:pending|unresolved)\b/giu, match => " ".repeat(match.length));
}

function containsNegativeReviewState(text) {
  const plain = visibleReviewText(text);
  const negativeState = /\b(?:unresolved|incomplete|pending|in[\s_./:-]*progress|changes[\s_./:-]*requested|fail(?:ed|ure)?|running|queued|cancel(?:led|ed)|error(?:ed)?|blocked|unknown|withdraw(?:n|al|ing)?|revok(?:e|ed|ing)|revocation|retracted|rescinded|rejected|declined|denied|aborted|abandoned|paused|suspended|skipped|stopped|terminated|expired|invalid|unavailable|inconclusive|deferred|unsuccessful|stale|outdated|superseded|waiting|timed[\s_./:-]*out|action[\s_./:-]*required)\b/i;
  const negatedSuccess = /\b(?:not|never|no[\s_./:-]*longer|(?:has|have|had|is|was|were|could|did|does|do)n['’]t|can['’]t|won['’]t|cannot|unable[\s_./:-]*to)(?:[\s_./:-]*(?:yet|fully|be|been|being|to))*[\s_./:-]*(?:complet(?:e|ed)|finish(?:ed)?|approv(?:e|ed)|start(?:ed)?|review(?:ed)?|pass(?:ed)?|valid(?:ate|ated)?|ready|done|success(?:ful(?:ly)?)?|available)\b/i;
  return negativeState.test(maskAbsentFindingStates(plain)) || negatedSuccess.test(plain) || /\bdo\s*not\s*merge\b/i.test(plain);
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
  const footer = body.match(/\s*<details>\s*<summary>ℹ️ About Codex in GitHub<\/summary>\s*(?:<br\s*\/>)?\s*((?:(?!<\/?details\b)[\s\S])*)<\/details>\s*$/);
  if (!footer || !codexHelpFooters.includes(footer[1].replace(/\s+/g, " ").trim())) return body;
  return body.slice(0, footer.index);
}

export function isAfterReviewRequest(value, marker) {
  const time = Date.parse(value || "");
  const cutoff = Date.parse(marker?.sourceCommentCreatedAt || marker?.requestedAt || marker?.commentCreatedAt || "");
  return Number.isFinite(time) && Number.isFinite(cutoff) && time >= cutoff;
}

// Completion clocks require a closed native presentation. Unknown prose is
// observed evidence; English/Markdown interpretation cannot backdate findings.
function hasCanonicalStructuredPresentation(body, state) {
  if (!state) return false;
  const raw = String(body);
  if (raw.split(/\r?\n/).some(line => /^(?: {4}| *\t|[^\S \t\r\n])/.test(line))) return false;
  const envelope = raw.trim().match(/^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 (.+?) -->\s*## Codex Review Summary(?:\s|$)/s);
  if (!envelope) return false;
  const visible = withoutCodexHelpFooter(raw.trim().slice(envelope[0].length)).trim();
  const blocks = visible.split(/\r?\n[ \t]*\r?\n/);
  if (blocks.length !== 2 || blocks[0] !== "This comment shows the latest Codex review activity on this pull request.") return false;
  const lines = blocks[1].split(/\r?\n/).map(line => line.trim());
  if (lines.shift() !== "| Review | Status | Commit | Review trigger |" ||
      !/^\|\s*-+\s*\|\s*-+\s*\|\s*-+\s*\|\s*-+\s*\|$/.test(lines.shift() || "")) return false;
  const expected = [["code_review", "Code Review"], ["security_review", "Security Review"]].filter(([key]) => state[key].status !== null);
  if (lines.length !== expected.length) return false;
  return expected.every(([key, label], index) => {
    const row = lines[index].match(/^\| (?:📝|🛡️|🔒) \*\*(Code Review|Security Review)\*\* \| (✅ \*\*Completed\*\*|🔄 \*\*Running\*\*(?: since)?)(?: <relative-time datetime="([^"<>]+)">([^<>]+)<\/relative-time>)? \| `([a-f0-9]{7,40})` \| (?:Manual request|Automatic review|PR opened) \|$/);
    const value = state[key];
    return row && row[1] === label && (value.status === "completed" ? row[2] === "✅ **Completed**" : value.status === "running" && row[2].startsWith("🔄 **Running**")) &&
      value.commit_sha?.startsWith(row[5]) && row[3] && row[3] === row[4] && Number.isFinite(Date.parse(row[3]));
  });
}

function isPositiveSummaryRendering(text, headSha, securityActive) {
  const visible = withoutCodexHelpFooter(text).trim();
  const lines = visible.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.shift() !== "This comment shows the latest Codex review activity on this pull request." ||
      lines.shift() !== "| Review | Status | Commit | Review trigger |" ||
      lines.shift() !== "| --- | --- | --- | --- |") return false;
  const seen = new Set();
  for (const line of lines) {
    const row = line.match(/^\| (?:📝|🛡️|🔒) \*\*(Code Review|Security Review)\*\* \| ✅ \*\*Completed\*\*(?: <relative-time datetime="([^"<>]+)">([^<>]+)<\/relative-time>)? \| `([a-f0-9]{7,40})` \| (?:Manual request|Automatic review|PR opened) \|$/);
    if (!row || seen.has(row[1]) || !headSha.startsWith(row[4]) ||
        (row[2] && (row[2] !== row[3] || !Number.isFinite(Date.parse(row[2]))))) return false;
    seen.add(row[1]);
  }
  return seen.has("Code Review") && seen.size === (securityActive ? 2 : 1) &&
    (!securityActive || seen.has("Security Review"));
}

function withoutMarkdownFences(body) {
  let fence = null;
  return String(body).split("\n").filter(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return false;
    }
    if (marker) { fence = marker[1]; return false; }
    return true;
  }).join("\n");
}

function parseStructuredCodexSummary(body, headSha, stateOnly = false, negativeOnly = false) {
  const originalBody = body;
  // Four-space/tab protocol openers are Markdown examples, never authority.
  const rawEnvelope = body.replace(/[^\S\r\n \t]/g, "");
  const leadingMarkers = rawEnvelope.match(/^\uFEFF?(?:[ \t]*\r?\n)*([ \t]*)<!--\s*codex-(?:pull-request-review-summary|review-state:)/);
  const leadingState = rawEnvelope.match(/^\uFEFF?(?:[ \t]*\r?\n)*[ \t]*<!-- codex-pull-request-review-summary -->[ \t]*\r?\n([ \t]*)<!--\s*codex-review-state:/);
  const leadingHeading = rawEnvelope.match(/^\uFEFF?(?:[ \t]*\r?\n)*[ \t]*<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 .+? -->[ \t]*\r?\n(?:[ \t]*\r?\n)*([ \t\uFEFF]*)## Codex Review Summary/s);
  if ([leadingMarkers, leadingState, leadingHeading].some(match => match && (/\t/.test(match[1]) || match[1].replace(/\uFEFF/g, "").length >= 4))) return null;
  body = body.trim();
  const protocolBody = withoutMarkdownFences(body).replace(/^(?: {4,}| *\t[ \t]*)<!--[^\n]*-->[ \t]*$/gm, "");
  const envelope = body.match(/^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 (.+?) -->\s*## Codex Review Summary(?:\s|$)/s);
  if (!envelope || (!negativeOnly && ((protocolBody.match(/<!--\s*codex-pull-request-review-summary\b/g) || []).length !== 1 ||
      (protocolBody.match(/<!--\s*codex-review-state:/g) || []).length !== 1 || /<!--\s*codex-review-receipt:/.test(body)))) return null;
  if (negativeOnly && ((envelope[0].match(/<!--\s*codex-pull-request-review-summary\b/g) || []).length !== 1 ||
      (envelope[0].match(/<!--\s*codex-review-state:/g) || []).length !== 1 || /<!--\s*codex-review-receipt:/.test(envelope[0]))) return null;
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
  if (stateOnly) return state;
  if (!/^[a-f0-9]{40}$/.test(String(headSha))) return null;
  if (code.commit_sha !== headSha) return null;
  // Conflicting visible severity or a second verdict cannot be hidden by JSON.
  const visibleVerdict = withoutCodexHelpFooter(body.slice(envelope[0].length));
  if (containsBlockingSeverity(body, "codex") || containsNegativeReviewState(visibleVerdict) ||
      /Codex Review:/i.test(visibleVerdict) || hasPositiveFindingStatement(visibleVerdict)) return { result: "fail", explicitSha: true };
  const security = state.security_review;
  if (code.has_any_findings || code.has_unresolved_findings || security.has_any_findings || security.has_unresolved_findings) {
    return { result: "fail", explicitSha: true };
  }
  const securityCompleted = security.status === null || (security.commit_sha === headSha && security.status === "completed");
  const completed = code.status === "completed" && securityCompleted;
  const positiveRendering = completed && hasCanonicalStructuredPresentation(originalBody, state) && isPositiveSummaryRendering(visibleVerdict, headSha, security.status !== null);
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
  if (isCodexStructuredSummarySignal(body)) {
    return parseStructuredCodexSummary(String(comment?.body || ""), headSha);
  }
  const receipt = body.startsWith("<!-- codex-review-receipt:v1 -->");
  // Legacy verdicts start at column zero, matching Actions startsWith exactly.
  // Structured envelopes and receipts retain their explicit marker grammar.
  if (!receipt && !/^Codex Review:/i.test(String(comment.body || ""))) return null;
  const text = (receipt ? body.slice("<!-- codex-review-receipt:v1 -->".length).trim() : body).replace(/\n\s*\[View task →\]\(https:\/\/chatgpt\.com\/s\/cd_[a-f0-9]{32}\)\s*$/, "").trim();
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
  const verdict = positiveText.match(/^Codex Review:\s*did(?:\s+not|\s*n['’]?t)\s+find\s+any\s+major\s+issues(?: for [a-f0-9]{10,40})?\.(.*)$/i);
  const positive = Boolean(verdict && CODEX_RECEIPT_ENCOURAGEMENTS.has(verdict[1].trim()));
  // Only the observed no-findings sentence is a positive verdict. Contradictory
  // prose (outside the optional standard help section) must fail closed.
  const verdictText = withoutCodexHelpFooter(text);
  const conflict = /\bfound\b/i.test(verdictText) || containsNegativeReviewState(verdictText);
  // Unknown prose carries no verdict. Only a newer independently affirmative
  // whole-review snapshot can supersede this pending native review signal.
  if (!positive && !conflict) return { result: "pending", explicitSha };
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


// The shared summary can be edited by security activity. Its server update
// time alone cannot prove that code review ran for this particular request.
function codeReviewCompletionTime(body, section = "Code Review", headSha = null, createdAt = null) {
  // Rendered-equivalent duplicate labels are ambiguity, never new clock authority.
  const rawRows = String(body).split(/\r?\n/).filter(line => new RegExp("^ {0,3}\\|[^|]*\\b" + section + "\\b", "i").test(renderedLabelAmbiguityText(line)));
  if (rawRows.length !== 1 || [...rawRows[0].matchAll(/<!--(?:>|->|[\s\S]*?(?:--!?>|$))/g)].some(comment => [...comment[0].matchAll(/\|/g)].some(pipe => markdownLinkOpenerAllowed(comment[0], pipe.index)))) return NaN;
  // A rendered code example cannot supply a canonical completion row.
  if ([...literalAwareVisibleText(body, true).matchAll(/<summary\b(?:[^"'<>]|"[^"]*"|'[^']*')*>([\s\S]*?)<\/summary>/gi)].some(match => renderedLabelAmbiguityText(match[1]).includes(section))) return NaN;
  body = withoutMarkdownFences(withoutAuthorityHtmlBlocks(String(body).replace(/<!--(?:>|->|[\s\S]*?(?:--!?>|$))/g, comment => comment.replace(/[^\r\n]/g, "")))).replace(/^ {1,3}(?=\|)/gm, "");
  const label = section === "Code Review" ? "📝 \\*\\*Code Review\\*\\*" : "(?:🛡️|🔒) \\*\\*Security Review\\*\\*";
  const rowPattern = new RegExp('^\\| ' + label + ' \\| ✅ \\*\\*Completed\\*\\* <relative-time datetime="([^"<>]+)">([^<>]+)</relative-time> \\| `([a-f0-9]{7,40})` \\| (?:Manual request|Automatic review|PR opened) \\|$', "gm");
  const rows = [...withoutCodexHelpFooter(String(body)).matchAll(rowPattern)];
  if ((String(body).match(new RegExp("^\\| " + label + " \\|", "gm")) || []).length !== 1 || rows.length !== 1 || (headSha && !headSha.startsWith(rows[0][3])) || rows[0][1] !== rows[0][2] ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(rows[0][1])) return NaN;
  const time = Date.parse(rows[0][1]);
  return Number.isFinite(time) && (!createdAt || (Number.isFinite(Date.parse(createdAt)) && Math.floor(time / 1000) >= Math.floor(Date.parse(createdAt) / 1000))) && new Date(time).toISOString().slice(0, 19) === rows[0][1].slice(0, 19) ? time : NaN;
}


// A request or code-only receipt cannot clear a typed finding from another
// section. Only a newer independently clean snapshot with that section's own
// canonical completion clock can retire the valid current-head finding.
function hasValidFindingCompanions(state, body, observed, headSha, resolvingSection = null, createdAt = null) {
  for (const [section, label, emoji] of [["code_review", "Code Review", "📝"], ["security_review", "Security Review", "🛡️"]]) {
    const value = state[section];
    if (section === resolvingSection) continue;
    if (!resolvingSection && value.commit_sha === headSha && (value.has_any_findings === true || value.has_unresolved_findings === true)) continue;
    if (value.status === null) {
      if (renderedLabelAmbiguityText(body).toLowerCase().includes(label.toLowerCase())) return false;
      continue;
    }
    const icons = section === "security_review" ? ["🛡️", "🔒"] : [emoji];
    const rowBody = resolvingSection && value.status === "running"
      ? icons.reduce((text, icon) => text.replace(`| ${icon} **${label}** | 🔄 **Running** since`, `| ${icon} **${label}** | ✅ **Completed**`).replace(`| ${icon} **${label}** | 🔄 **Running**`, `| ${icon} **${label}** | ✅ **Completed**`), String(body))
      : body;
    if (resolvingSection && value.status === "running" && rowBody === body) return false;
    const completed = codeReviewCompletionTime(rowBody, label, value.commit_sha);
    if (!(value.status === "completed" || (resolvingSection && value.status === "running")) || !Number.isFinite(completed) || completed > Math.floor(observed / 1000) * 1000 + 999) return false;
  }
  return true;
}

// Negative-only projection: a coherent companion's trigger belongs to that
// section. It never supplies clean/approval authority.
function negativeSectionRow(body, value, label, observed, createdAt = null) {
  if (value.status !== "completed") return null;
  const rows = String(body).split(/\r?\n/).filter(line => line.includes("**" + label + "**"));
  if (rows.length !== 1) return null;
  const row = rows[0], structural = (value.has_any_findings === true || value.has_unresolved_findings === true) ? row.replace(/^(\|[^|]*\|[^|]+\|\s*`[a-f0-9]{7,40}`\s*\|)[^|\r\n]*(\|\s*)$/, "$1 Manual request $2") : row;
  const completed = codeReviewCompletionTime(String(body).replace(row, structural), label, value.commit_sha, createdAt);
  return Number.isFinite(completed) && completed <= Math.floor(observed / 1000) * 1000 + 999 ? row : null;
}

function negativeSectionBody(body, state, section, observed, createdAt = null) {
  const other = section === "code_review" ? "security_review" : "code_review";
  const row = negativeSectionRow(body, state[other], other === "code_review" ? "Code Review" : "Security Review", observed);
  return row ? String(body).replace(row, "") : body;
}

function structuredNegativeTime(comment, headSha) {
  const observed = Date.parse(comment.updated_at || comment.created_at || "");
  const state = parseStructuredCodexSummary(String(comment.body || ""), headSha, true);
  if (!state || !hasValidFindingCompanions(state, comment.body, observed, headSha, null, comment.created_at)) return observed;
  const times = [];
  for (const [section, label] of [["code_review", "Code Review"], ["security_review", "Security Review"]]) {
    const value = state[section];
    if (value.commit_sha !== headSha || !(value.has_any_findings === true || value.has_unresolved_findings === true)) continue;
    const completed = codeReviewCompletionTime(comment.body, label, headSha, comment.created_at);
    times.push(!hasVisibleStructuredConflict(comment.body, section) && value.status === "completed" && Number.isFinite(completed) && completed <= Math.floor(observed / 1000) * 1000 + 999 ? Math.floor(completed / 1000) * 1000 : observed);
  }
  return times.length ? Math.max(...times) : observed;
}

function hasVisibleStructuredConflict(body, section = null) {
  const state = parseStructuredCodexSummary(String(body || ""), null, true);
  return !hasCanonicalStructuredPresentation(body, state);
}

function isSupersededTypedFinding(comment, snapshots, headSha) {
  const body = String(comment.body || "").trim();
  const state = parseStructuredCodexSummary(String(comment.body || ""), headSha, true);
  if (!state) return false;
  const visible = withoutCodexHelpFooter(body.replace(/^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 .+? -->\s*## Codex Review Summary/s, ""));
  const observed = Date.parse(comment.updated_at || comment.created_at || "");
  if (!hasValidFindingCompanions(state, body, observed, headSha, null, comment.created_at)) return false;
  const findings = [["code_review", "Code Review"], ["security_review", "Security Review"]].filter(([section]) => state[section].commit_sha === headSha && (state[section].has_any_findings === true || state[section].has_unresolved_findings === true));
  return findings.length > 0 && findings.every(([section, label]) => {
    const scoped = body;
    const ownRow = negativeSectionRow(body, state[section], label, observed, comment.created_at);
    const hardBody = ownRow ? scoped.replace(ownRow, "") : scoped;
    const visible = withoutCodexHelpFooter(hardBody);
    if (containsBlockingSeverity(hardBody, "codex") || containsNegativeReviewState(visible) || /Codex Review:/i.test(visibleReviewText(visible))) return false;
    const completed = codeReviewCompletionTime(body, label, headSha, comment.created_at);
    const fence = Math.floor((!hasVisibleStructuredConflict(body, section) && state[section].status === "completed" && Number.isFinite(completed) && completed <= Math.floor(observed / 1000) * 1000 + 999 ? completed : observed) / 1000);
    return snapshots.some(({ comment: clean }) => {
      if (clean === comment || hasVisibleStructuredConflict(clean.body, section)) return false;
      const cleanState = parseStructuredCodexSummary(String(clean.body || ""), headSha, true);
      if (!cleanState || !hasValidFindingCompanions(cleanState, clean.body, Date.parse(clean.updated_at || clean.created_at || ""), headSha, section, clean.created_at)) return false;
      const value = cleanState[section];
      const time = codeReviewCompletionTime(clean.body, label, headSha, clean.created_at);
      const updated = Date.parse(clean.updated_at || clean.created_at || "");
      return value.commit_sha === headSha && value.status === "completed" && value.has_any_findings === false && value.has_unresolved_findings === false && Number.isFinite(time) && time <= Math.floor(updated / 1000) * 1000 + 999 && Math.floor(time / 1000) > fence;
    });
  });
}

function hasUnclearedStructuredFindings(snapshots, headSha) {
  const states = snapshots.map(({ comment, result }) => ({ comment, result,
    state: parseStructuredCodexSummary(String(comment.body || ""), headSha, true),
    negativeState: parseStructuredCodexSummary(String(comment.body || ""), headSha, true, true),
    time: Date.parse(comment.updated_at || comment.created_at || "")
  })).filter((entry) => (entry.state || entry.negativeState) && Number.isFinite(entry.time));
  for (const [section, label] of [["code_review", "Code Review"], ["security_review", "Security Review"]]) {
    // An unpaired completed/null code lifecycle has no verdict. Security
    // activity cannot retire it by carrying an older code completion clock.
    const findings = states.map(entry => ({ ...entry, state: entry.negativeState || entry.state })).filter(({ state, result }) => state[section].commit_sha === headSha &&
      (state[section].has_any_findings === true || state[section].has_unresolved_findings === true ||
       (section === "code_review" && result !== "pass" && state[section].status === "completed" && state[section].has_any_findings === null && state[section].has_unresolved_findings === null)));
    if (!findings.length) continue;
    const fence = Math.max(...findings.map(({ comment, state, time }) => {
      const completed = codeReviewCompletionTime(comment.body, label, headSha, comment.created_at);
      const unknownVerdict = state[section].has_any_findings === null && state[section].has_unresolved_findings === null;
      return Math.floor((!unknownVerdict && !hasVisibleStructuredConflict(comment.body, section) && state[section].status === "completed" && Number.isFinite(completed) && completed <= Math.floor(time / 1000) * 1000 + 999 ? completed : time) / 1000);
    }));
    const cleared = states.some(({ comment, state, result, time }) => {
      if (!state) return false;
      const value = state[section];
      const completed = codeReviewCompletionTime(comment.body, label, headSha, comment.created_at);
      return hasValidFindingCompanions(state, comment.body, time, headSha, section, comment.created_at) && !hasVisibleStructuredConflict(comment.body, section) && value.commit_sha === headSha && value.status === "completed" &&
        value.has_any_findings === false && value.has_unresolved_findings === false &&
        Number.isFinite(completed) && completed <= Math.floor(time / 1000) * 1000 + 999 && Math.floor(completed / 1000) > fence;
    });
    if (!cleared) return true;
  }
  return false;
}


function isCompletedCleanHistory(comment, headSha) {
  const body = String(comment.body || ""), state = parseStructuredCodexSummary(body, headSha, true);
  const observed = Date.parse(comment.updated_at || comment.created_at || "");
  return parseStructuredCodexSummary(body, headSha)?.result === "pass" && state &&
    [["code_review", "Code Review"], ["security_review", "Security Review"]].every(([key, label]) => {
      const value = state[key], time = codeReviewCompletionTime(body, label, headSha);
      return value.commit_sha === headSha && value.status === "completed" && value.has_any_findings === false && value.has_unresolved_findings === false && Number.isFinite(time) && time <= Math.floor(observed / 1000) * 1000 + 999;
    }) && ["Code Review", "Security Review"].some(label => Number.isFinite(codeReviewCompletionTime(body, label, headSha, comment.created_at)));
}

function hasFreshCodeReviewCompletion(body, requestMarker, updatedAt, createdAt) {
  const time = codeReviewCompletionTime(body, "Code Review", null, createdAt);
  const cutoff = Date.parse(requestMarker?.sourceCommentCreatedAt || requestMarker?.requestedAt || requestMarker?.commentCreatedAt || "");
  const snapshotTime = Date.parse(updatedAt || "");
  // Every active completed section must fit this server observation bucket.
  // Companions may carry older clocks from before this comment was created.
  const state = parseStructuredCodexSummary(body, null, true);
  const coherent = state && hasValidFindingCompanions(state, withoutCodexHelpFooter(body), Math.floor(snapshotTime / 1000) * 1000, state.code_review.commit_sha);
  // GitHub comment timestamps have second precision; row times retain fractions.
  return coherent && Number.isFinite(time) && Number.isFinite(cutoff) && Number.isFinite(snapshotTime) &&
    Math.floor(time / 1000) > Math.floor(cutoff / 1000) && Math.floor(time / 1000) <= Math.floor(snapshotTime / 1000);
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
    const times = summaries.map((comment) => structuredNegativeTime(comment, headSha));
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
    if (isCodexStructuredSummarySignal(comment.body) && parsed && parsed.result !== "fail" &&
        (!hasFreshCodeReviewCompletion(comment.body, requestMarker, reviewEvidenceTime(comment), comment.created_at) ||
         Math.floor(codeReviewCompletionTime(comment.body, "Code Review", headSha, comment.created_at) / 1000) <= Math.floor(structuredWithdrawalTime / 1000))) return { ...parsed, result: "pending", requiresCodeReceipt: false };
    if (!parsed?.requiresCodeReceipt) return parsed;
    const lifecycleState = parseStructuredCodexSummary(comment.body, headSha, true);
    if (!hasCanonicalStructuredPresentation(comment.body, lifecycleState) || lifecycleState.security_review.status !== null) return { ...parsed, result: "pending", requiresCodeReceipt: false };
    const completed = codeReviewCompletionTime(comment.body, "Code Review", headSha, comment.created_at);
    const lifecycleCreated = Date.parse(comment.created_at || "");
    const receiptTimes = comments.flatMap((receipt) => {
      if (!String(receipt.body || "").trim().startsWith("<!-- codex-review-receipt:v1 -->") ||
          !isAfterReviewRequest(receipt.created_at, requestMarker) ||
          !(Date.parse(receipt.created_at || "") > structuredWithdrawalTime)) return [];
      const receiptCreated = Date.parse(receipt.created_at || "");
      if ((receipt.updated_at && receipt.updated_at !== receipt.created_at) || !(receiptCreated >= lifecycleCreated && receiptCreated <= completed)) return [];
      const verdict = classifyCodexSummaryComment(receipt, headSha, requestMarker, config);
      return verdict?.result === "pass" && verdict.explicitSha === true ? [Date.parse(receipt.created_at)] : [];
    });
    return { ...parsed, result: receiptTimes.length ? "pass" : "pending", corroborationTime: Math.max(...receiptTimes) };
  };
  if (hasUnclearedStructuredFindings(summaries.map((comment) => ({ comment, result: effectiveCommentResult(comment)?.result })), headSha)) return "pending";
  const history = summaries.map(comment => ({ comment }));
  const retired = summaries.filter(comment => isSupersededTypedFinding(comment, history, headSha));
  const compatibleHistory = new Set();
  if (retired.length && !Number.isFinite(structuredWithdrawalTime)) for (const summary of summaries) {
    if (!isCompletedCleanHistory(summary, headSha)) continue;
    const observed = Date.parse(reviewEvidenceTime(summary) || "");
    if (comments.some(receipt => !isCodexStructuredSummarySignal(receipt.body) &&
      isAfterReviewRequest(receipt.created_at, requestMarker) && Date.parse(receipt.created_at || "") > observed &&
      classifyCodexSummaryComment(receipt, headSha, requestMarker, config)?.result === "pass")) compatibleHistory.add(summary);
  }
  const summaryResults = latestSummaries.filter(comment => !compatibleHistory.has(comment) && !isSupersededTypedFinding(comment, history, headSha)).map((comment) => effectiveCommentResult(comment)?.result || "pending");
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
    if (compatibleHistory.has(comment)) continue;
    if (isSupersededTypedFinding(comment, history, headSha)) continue;
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
    const eligibilityTime = isCodexStructuredSummarySignal(comment.body) || parsed.result !== "pass"
      ? reviewEvidenceTime(comment) : comment.created_at;
    const fresh = isCodexStructuredSummarySignal(comment.body)
      ? Date.parse(eligibilityTime || "") > Date.parse(requestMarker?.sourceCommentCreatedAt || requestMarker?.requestedAt || requestMarker?.commentCreatedAt || "")
      : isAfterReviewRequest(eligibilityTime, requestMarker);
    if (!fresh && parsed.result !== "fail") continue;
    if (!parsed.explicitSha && hasHeadUpdateBetweenTimestamps(timeline,
      requestMarker?.sourceCommentCreatedAt || requestMarker?.requestedAt, eligibilityTime)) continue;
    // An edit cannot refresh SHA-less request/head eligibility, but an accepted
    // negative edit must invalidate a positive verdict posted before the edit.
    const orderingTime = parsed.result === "pass" && isCodexStructuredSummarySignal(comment.body)
      ? new Date(Math.floor(codeReviewCompletionTime(comment.body, "Code Review", headSha, comment.created_at) / 1000) * 1000).toISOString()
      : parsed.result === "fail" && isCodexStructuredSummarySignal(comment.body) ? new Date(structuredNegativeTime(comment, headSha)).toISOString() : parsed.result === "fail" ? reviewEvidenceTime(comment) : eligibilityTime;
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
