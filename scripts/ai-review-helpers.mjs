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

function literalAwareVisibleText(value) {
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
  return normalizeVisibleFragment(rawVisibleHtml(String(value || "")));
}

function hasPositiveFindingStatement(text) {
  const cardinal = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?)";
  const paragraphs = String(text).replace(/\r\n/g, "\n").split(/[\r\n][ \t\f\v]*[\r\n]/);
  return paragraphs.some((paragraph) => paragraph.replace(/[ \t\r\n\f\v]+/g, " ")
    .replace(new RegExp("\\b(?:no|zero) +(?:issues?|findings?|problems?|bugs?|flaws?|vulnerabilit(?:y|ies))[^.!?;]*?\\bexcept +((?:[1-9][0-9]*|some|several|multiple|" + cardinal + "))\\b([^.!?;]*)", "giu"), (match, count, suffix) => match + "; " + count + " findings" + (suffix.trim() ? suffix.replace(/^ *, */, " ") : " remain"))
    .replace(/\b(no|zero) +((?:issues?|findings?|problems?|bugs?|flaws?|vulnerabilit(?:y|ies))) +(?:and|or) +(?:issues?|findings?|problems?|bugs?|flaws?|vulnerabilit(?:y|ies))\b/giu, "$1 $2")
    .replace(/\b(no|zero) +(?:(?!(?:issues?|findings?|problems?|bugs?|flaws?|vulnerabilit(?:y|ies)|is|are|was|were|has|have|been|get|gets|got|a|an|one|some|several|multiple)\b)[\p{L}-]+ +)+(?:and|or) +(?:(?!(?:issues?|findings?|problems?|bugs?|flaws?|vulnerabilit(?:y|ies)|is|are|was|were|has|have|been|get|gets|got|a|an|one|some|several|multiple)\b)[\p{L}-]+ +)*((?:issues?|findings?|problems?|bugs?|flaws?|vulnerabilit(?:y|ies))\b)/giu, "$1 $2")
    .split(/[.!?;]|(?<![0-9]),|,(?![0-9])|\b(?:and|or|but|however|yet)\b/i).some((clause) => {
      // Negating a resolution preserves the finding, unlike negating its noun.
      clause = clause.replace(/\b(?:not|never) +(?:(?:be|been|being|get|gets|got|gotten|getting) +)*(?:resolved|fixed|addressed|cleared|removed|closed|eliminated)\b|\b(?:is|are|was|were|has|have|had)n['’]t +(?:(?:be|been|being|get|gets|got|gotten|getting) +)*(?:resolved|fixed|addressed|cleared|removed|closed|eliminated)\b/gi, " unresolved ");
      const noun = "(?<![\\p{L}\\p{N}_\\p{Pd}])(?:issues?|findings?|problems?|bugs?|flaws?|vulnerabilit(?:y|ies))(?![\\p{L}\\p{N}_\\p{Pd}])";
      const headingNoun = noun.replace("(?![\\p{L}\\p{N}_\\p{Pd}])", "(?![\\p{L}\\p{N}_-])");
      const isAffirmative = (match, counted = false) => {
        const before = clause.slice(0, match.index);
        const after = clause.slice(match.index + match[0].length);
        if (!counted && /^ *(?::|[–—-]) *(?:no|none|zero|0+(?:,000)*)(?: +(?:(?:is|are|was|were|be|been|being|has|have|had|[\p{L}]+ly|now) +)*(?:found|outstanding|exist|exists|remain|remains))? *$/iu.test(after)) return false;
        // Scope negation to this construction, not an unrelated earlier clause.
        if (/\b(?:no|zero|not|without|never|cannot)\b|\b[\p{L}]+n['’]t\b/iu.test(match[0])) return false;
        if (/(?:\b(?:no|zero|not|without|never|cannot)|\b[\p{L}]+n['’]t)(?: +(?:be|been|being|get|gets|got|gotten|getting|considered))* +$/iu.test(before)) return false;
        const matchedNoun = [...match[0].matchAll(new RegExp(noun, "giu"))].at(-1);
        const predicate = matchedNoun ? match[0].slice(matchedNoun.index + matchedNoun[0].length) : match[0];
        const modifiers = matchedNoun ? match[0].slice(0, matchedNoun.index) : "";
        if (/\b(?:resolved|fixed|addressed|cleared|removed|closed|eliminated)\b/i.test(modifiers) && !/^ +(?:(?:is|are|was|were|has|have|had|be|been|being|get|gets|got|gotten|getting) +)*(?:(?:can|could|may|might|will|would|must|should) +(?:reappear|recur)|found +again|(?:still +)?(?:persists?|remains?|exists?))\b/iu.test(predicate + after)) return false;
        if (/\b(?:resolved|fixed|addressed|cleared|removed|closed|eliminated|harmless|benign)\b/i.test(predicate)) return false;
        if (/^(?: +| *(?::|[–—-]) *)(?:(?:that|which) +)?(?:(?:is|are|was|were|has|have|had|be|been|being|get|gets|got|gotten|getting|now) +)*(?:resolved|fixed|addressed|cleared|removed|closed|eliminated)\b/i.test(after)) return false;
        return true;
      };
      const counts = [...clause.matchAll(new RegExp("(?<![\\p{L}\\p{N}_])[*_~`]*([0-9]+(?:,[0-9]{3})*)[*_~`]* +(?:[\\p{L}-]+ +)*?" + noun, "giu"))];
      if (counts.some((match) => !/^0+$/.test(match[1].replaceAll(",", "")) && isAffirmative(match, true))) return true;
      const reporting = clause.replace(new RegExp("(?<![\\p{L}\\p{N}_])[*_~`]*0+(?:,000)*[*_~`]* +(?:[\\p{L}-]+ +)*?" + noun, "giu"), (match) => " ".repeat(match.length));
      const cardinalPattern = "\\b" + cardinal + " +(?:[\\p{L}-]+ +)*?" + noun;
      if ([...reporting.matchAll(new RegExp(cardinalPattern, "giu"))].some((match) => isAffirmative(match, true))) return true;
      const patterns = [
        "\\b(?:a|an) +(?:[\\p{L}-]+ +)*?" + noun + " +(?:(?:can|could|may|might|will|would|must|should) +[\\p{L}-]+|[\\p{L}]+s)\\b",
        "\\bthe +" + noun + " +(?:(?:is|are|was|were) +[\\p{L}-]+|(?:can|could|may|might|will|would|must|should) +[\\p{L}-]+|[\\p{L}]+s)\\b",
        "\\b(?:this|that|these|those) +(?:(?:code|security|blocking|critical|high|medium|low|major|minor|unresolved|open|new|resolved|fixed|addressed|cleared|removed|closed|eliminated) +)*" + noun + " +(?:(?:is|are|was|were) +[\\p{L}-]+|[\\p{L}]+s)\\b",
        "\\b(?:this|that|these|those) +(?:is|are|was|were) +(?:a|an) +(?:[\\p{L}-]+ +)*?" + noun,
        "(?<![\\p{L}\\p{N}_] )\\b(?:(?:a|an|one|some|several|multiple) +)?(?:(?!(?:the|this|that|these|those)\\b)[\\p{L}-]+ +)*?" + headingNoun + "(?= *(?::|[–—-]) *[^ \\t])",
        "\\b(?:found|[\\p{L}]+ed) +(?:[\\p{L}-]+ +)*?" + noun,
        "(?:\\b(?:a|an|one|some|several|multiple|[0-9]+) +(?:[\\p{L}-]+ +)*?" + noun + "|\\bthe +" + noun + "|(?<![\\p{L}\\p{N}_] )" + noun + ")" + " +(?:(?:is|are|was|were|has|have|had|be|been|being|get|gets|got|gotten|getting|still) +)*(?:found|[\\p{L}]+ed|remains?|exists?)\\b",
        "\\bthere +(?:still +)?(?:is|are) +(?:[\\p{L}-]+ +)*?" + noun,
        "\\b(?:a|an) +(?:[\\p{L}-]+ +)*?" + noun + " +(?:(?:is|are|was|were) +[\\p{L}-]+|(?!(?:is|was|has)\\b)[\\p{L}]+s)\\b",
        "\\b(?:this|that|these|those) +" + noun + " +(?:(?:is|are|was|were) +[\\p{L}-]+|(?!(?:is|was|has)\\b)[\\p{L}]+s)\\b",
        "(?:\\b(?:both|many|all) +|(?<![\\p{L}\\p{N}_] ))(?:issues|findings|problems|bugs|flaws|vulnerabilities)\\b +(?:(?:is|are|was|were) +[\\p{L}-]+|(?!(?:is|was|has)\\b)[\\p{L}]+)\\b"
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
function activeMarkdownEmphasis(text) {
  const removed = new Set();
  const runs = [];
  const whitespace = (value) => !value || /\s/u.test(value);
  const punctuation = (value) => !!value && /[\p{P}\p{S}]/u.test(value);
  const escaped = (index) => ((text.slice(0, index).match(/\\+$/)?.[0].length || 0) % 2) === 1;
  // Matched code-span delimiters disappear; their literal content is protected
  // by the existing code-context stage before this projection.
  const ticks = [...text.matchAll(/`+/g)];
  let consumed = 0;
  for (let i = 0; i < ticks.length; i += 1) {
    const start = ticks[i];
    if (start.index < consumed || escaped(start.index)) continue;
    const end = ticks.slice(i + 1).find((run) => run[0].length === start[0].length);
    if (!end) continue;
    for (let j = 0; j < start[0].length; j += 1) { removed.add(start.index + j); removed.add(end.index + j); }
    consumed = end.index + end[0].length;
  }
  for (const match of text.matchAll(/\*+|_+|~{2,}/g)) {
    if (escaped(match.index)) continue;
    const before = [...text.slice(0, match.index)].at(-1) || "";
    const after = [...text.slice(match.index + match[0].length)][0] || "";
    const left = !whitespace(after) && (!punctuation(after) || whitespace(before) || punctuation(before));
    const right = !whitespace(before) && (!punctuation(before) || whitespace(after) || punctuation(after));
    runs.push({ character: match[0][0], start: match.index, length: match[0].length, usedOpen: 0, usedClose: 0,
      open: match[0][0] === "_" ? left && (!right || punctuation(before)) : left,
      close: match[0][0] === "_" ? right && (!left || punctuation(after)) : right });
  }
  for (let closeIndex = 0; closeIndex < runs.length; closeIndex += 1) {
    const closer = runs[closeIndex];
    if (!closer.close) continue;
    for (let openIndex = closeIndex - 1; openIndex >= 0 && closer.length - closer.usedClose >= (closer.character === "~" ? 2 : 1); openIndex -= 1) {
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
  }
  return text.split("").map((character, index) => removed.has(index) ? "" : character).join("");
}

function normalizeVisibleFragment(value, rawHtml = false) {
  if (rawHtml) value = canonicalizeLegacyHtmlReferences(value, () => true);
  const normalized = value.replace(rawHtml ? /&#(x[0-9a-f]+|[0-9]+);?/gi : /&#(x[0-9a-f]+|[0-9]+);/gi, (entity, digits) => {
    const point = digits[0].toLowerCase() === "x" ? parseInt(digits.slice(1), 16) : Number(digits);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  }).replace(/&(ZeroWidthSpace|NegativeVeryThinSpace|NegativeThinSpace|NegativeMediumSpace|NegativeThickSpace|NoBreak|zwnj|zwj|lrm|rlm|shy);/g, "").replace(/\p{Default_Ignorable_Code_Point}/gu, "").replace(/&(nbsp|NonBreakingSpace|ensp|emsp|emsp13|emsp14|numsp|puncsp|thinsp|ThinSpace|hairsp|VeryThinSpace|MediumSpace|ThickSpace|Tab|NewLine);/g, " ");
  return rawHtml ? normalized : activeMarkdownEmphasis(normalized);
}

function containsNegativeReviewState(text) {
  const plain = visibleReviewText(text);
  const negativeState = /\b(?:unresolved|incomplete|pending|in[\s_./:-]*progress|changes[\s_./:-]*requested|fail(?:ed|ure)?|running|queued|cancel(?:led|ed)|error(?:ed)?|blocked|unknown|withdraw(?:n|al|ing)?|revok(?:e|ed|ing)|revocation|retracted|rescinded|rejected|declined|denied|aborted|abandoned|paused|suspended|skipped|stopped|terminated|expired|invalid|unavailable|inconclusive|deferred|unsuccessful|stale|outdated|superseded|waiting|timed[\s_./:-]*out|action[\s_./:-]*required)\b/i;
  const negatedSuccess = /\b(?:not|never|no[\s_./:-]*longer|(?:has|have|had|is|was|were|could|did|does|do)n['’]t|can['’]t|won['’]t|cannot|unable[\s_./:-]*to)(?:[\s_./:-]*(?:yet|fully|be|been|being|to))*[\s_./:-]*(?:complet(?:e|ed)|finish(?:ed)?|approv(?:e|ed)|start(?:ed)?|review(?:ed)?|pass(?:ed)?|valid(?:ate|ated)?|ready|done|success(?:ful(?:ly)?)?|available)\b/i;
  return negativeState.test(plain) || negatedSuccess.test(plain) || /\bdo\s*not\s*merge\b/i.test(plain);
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
  if (!/^[a-f0-9]{40}$/.test(String(headSha))) return null;
  if (stateOnly) return state;
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
  if (isCodexStructuredSummarySignal(body)) {
    return parseStructuredCodexSummary(String(comment?.body || ""), headSha);
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
function codeReviewCompletionTime(body, section = "Code Review", headSha = null) {
  // Rendered-equivalent duplicate labels are ambiguity, never new clock authority.
  const rawRows = String(body).split(/\r?\n/).filter(line => new RegExp("^ {0,3}\\|[^|]*\\b" + section + "\\s*\\|", "i").test(renderedLabelAmbiguityText(line)));
  if (rawRows.length !== 1 || [...rawRows[0].matchAll(/<!--(?:>|->|[\s\S]*?(?:--!?>|$))/g)].some(comment => [...comment[0].matchAll(/\|/g)].some(pipe => markdownLinkOpenerAllowed(comment[0], pipe.index)))) return NaN;
  // A rendered code example cannot supply a canonical completion row.
  if ([...String(body).matchAll(/<summary\b(?:[^"'<>]|"[^"]*"|'[^']*')*>([\s\S]*?)<\/summary>/gi)].some(match => renderedLabelAmbiguityText(match[1]).includes(section))) return NaN;
  body = withoutMarkdownFences(withoutAuthorityHtmlBlocks(String(body).replace(/<!--(?:>|->|[\s\S]*?(?:--!?>|$))/g, comment => comment.replace(/[^\r\n]/g, "")))).replace(/^ {1,3}(?=\|)/gm, "");
  const label = section === "Code Review" ? "📝 \\*\\*Code Review\\*\\*" : "🛡️ \\*\\*Security Review\\*\\*";
  const rowPattern = new RegExp('^\\| ' + label + ' \\| ✅ \\*\\*Completed\\*\\* <relative-time datetime="([^"<>]+)">([^<>]+)</relative-time> \\| `([a-f0-9]{7,40})` \\| (?:Manual request|Automatic review) \\|$', "gm");
  const rows = [...withoutCodexHelpFooter(String(body)).matchAll(rowPattern)];
  if ((String(body).match(new RegExp("^\\| " + label + " \\|", "gm")) || []).length !== 1 || rows.length !== 1 || (headSha && !headSha.startsWith(rows[0][3])) || rows[0][1] !== rows[0][2] ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(rows[0][1])) return NaN;
  const time = Date.parse(rows[0][1]);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === rows[0][1].slice(0, 19) ? time : NaN;
}


// A request or code-only receipt cannot clear a typed finding from another
// section. Only a newer independently clean snapshot with that section's own
// canonical completion clock can retire the valid current-head finding.
function hasValidFindingCompanions(state, body, observed, headSha, resolvingSection = null) {
  for (const [section, label, emoji] of [["code_review", "Code Review", "📝"], ["security_review", "Security Review", "🛡️"]]) {
    const value = state[section];
    if (section === resolvingSection) continue;
    if (!resolvingSection && value.commit_sha === headSha && (value.has_any_findings === true || value.has_unresolved_findings === true)) continue;
    if (value.status === null) {
      if (renderedLabelAmbiguityText(body).toLowerCase().includes(label.toLowerCase())) return false;
      continue;
    }
    const rowBody = resolvingSection && value.status === "running"
      ? String(body).replace(`| ${emoji} **${label}** | 🔄 **Running** since`, `| ${emoji} **${label}** | ✅ **Completed**`).replace(`| ${emoji} **${label}** | 🔄 **Running**`, `| ${emoji} **${label}** | ✅ **Completed**`)
      : body;
    if (resolvingSection && value.status === "running" && rowBody === body) return false;
    const completed = codeReviewCompletionTime(rowBody, label, value.commit_sha);
    if (!(value.status === "completed" || (resolvingSection && value.status === "running")) || !Number.isFinite(completed) || completed > observed + 999) return false;
  }
  return true;
}

// Negative-only projection: a coherent companion's trigger belongs to that
// section. It never supplies clean/approval authority.
function negativeSectionRow(body, value, label, observed) {
  if (value.status !== "completed") return null;
  const rows = String(body).split(/\r?\n/).filter(line => line.includes("**" + label + "**"));
  if (rows.length !== 1) return null;
  const row = rows[0], structural = (value.has_any_findings === true || value.has_unresolved_findings === true) ? row.replace(/^(\|[^|]*\|[^|]+\|\s*`[a-f0-9]{7,40}`\s*\|)[^|\r\n]*(\|\s*)$/, "$1 Manual request $2") : row;
  const completed = codeReviewCompletionTime(String(body).replace(row, structural), label, value.commit_sha);
  return Number.isFinite(completed) && completed <= observed + 999 ? row : null;
}

function negativeSectionBody(body, state, section, observed) {
  const other = section === "code_review" ? "security_review" : "code_review";
  const row = negativeSectionRow(body, state[other], other === "code_review" ? "Code Review" : "Security Review", observed);
  return row ? String(body).replace(row, "") : body;
}

function structuredNegativeTime(comment, headSha) {
  const observed = Date.parse(comment.updated_at || comment.created_at || "");
  const state = parseStructuredCodexSummary(String(comment.body || ""), headSha, true);
  if (!state || !hasValidFindingCompanions(state, comment.body, observed, headSha)) return observed;
  const times = [];
  for (const [section, label] of [["code_review", "Code Review"], ["security_review", "Security Review"]]) {
    const value = state[section];
    if (value.commit_sha !== headSha || !(value.has_any_findings === true || value.has_unresolved_findings === true)) continue;
    const completed = codeReviewCompletionTime(comment.body, label, headSha);
    times.push(!hasVisibleStructuredConflict(negativeSectionBody(comment.body, state, section, observed), section) && value.status === "completed" && Number.isFinite(completed) && completed <= observed + 999 ? Math.floor(completed / 1000) * 1000 : observed);
  }
  return times.length ? Math.max(...times) : observed;
}

function hasVisibleStructuredConflict(body, section = null) {
  if (/^(?: {4,}| *\t[ \t]*)<!--/m.test(String(body))) return true;
  let visible = withoutCodexHelpFooter(String(body).trim().replace(/^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 .+? -->\s*## Codex Review Summary/s, ""));
  visible = visible.replace(/^ {1,3}(?=\|)/gm, "");
  if (section) {
    const other = section === "code_review" ? "| 🛡️ **Security Review** |" : "| 📝 **Code Review** |";
    const rows = visible.split("\n").filter(line => line.startsWith(other));
    if (rows.some(line => !/^\| [📝🛡️]+ \*\*(?:Code|Security) Review\*\* \| (?:✅ \*\*Completed\*\*|🔄 \*\*Running\*\*)(?: since)?(?: <relative-time datetime="[^"<>]+">[^<>]+<\/relative-time>)? \| `[a-f0-9]{7,40}` \| (?:Manual request|Automatic review) \|$/.test(line))) return true;
  }
  if (section) visible = visible.split("\n").filter(line => !line.startsWith(section === "code_review" ? "| 🛡️ **Security Review** |" : "| 📝 **Code Review** |")).join("\n");
  return /<!--\s*codex-/i.test(visible) || containsBlockingSeverity(body, "codex") || containsNegativeReviewState(visible) || /Codex Review:/i.test(visibleReviewText(visible)) || hasPositiveFindingStatement(visibleReviewText(visible));
}

function isSupersededTypedFinding(comment, snapshots, headSha) {
  const body = String(comment.body || "").trim();
  const state = parseStructuredCodexSummary(String(comment.body || ""), headSha, true);
  if (!state) return false;
  const visible = withoutCodexHelpFooter(body.replace(/^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 .+? -->\s*## Codex Review Summary/s, ""));
  const observed = Date.parse(comment.updated_at || comment.created_at || "");
  if (!hasValidFindingCompanions(state, body, observed, headSha)) return false;
  const findings = [["code_review", "Code Review"], ["security_review", "Security Review"]].filter(([section]) => state[section].commit_sha === headSha && (state[section].has_any_findings === true || state[section].has_unresolved_findings === true));
  return findings.length > 0 && findings.every(([section, label]) => {
    const scoped = negativeSectionBody(body, state, section, observed);
    const ownRow = negativeSectionRow(body, state[section], label, observed);
    const hardBody = ownRow ? scoped.replace(ownRow, "") : scoped;
    const visible = withoutCodexHelpFooter(hardBody);
    if (containsBlockingSeverity(hardBody, "codex") || containsNegativeReviewState(visible) || /Codex Review:/i.test(visibleReviewText(visible))) return false;
    const completed = codeReviewCompletionTime(body, label, headSha);
    const fence = Math.floor((!hasVisibleStructuredConflict(scoped, section) && state[section].status === "completed" && Number.isFinite(completed) && completed <= observed + 999 ? completed : observed) / 1000);
    return snapshots.some(({ comment: clean }) => {
      if (clean === comment || hasVisibleStructuredConflict(clean.body, section)) return false;
      const cleanState = parseStructuredCodexSummary(String(clean.body || ""), headSha, true);
      if (!cleanState || !hasValidFindingCompanions(cleanState, clean.body, Date.parse(clean.updated_at || clean.created_at || ""), headSha, section)) return false;
      const value = cleanState[section];
      const time = codeReviewCompletionTime(clean.body, label, headSha);
      const updated = Date.parse(clean.updated_at || clean.created_at || "");
      return value.commit_sha === headSha && value.status === "completed" && value.has_any_findings === false && value.has_unresolved_findings === false && Number.isFinite(time) && time <= updated + 999 && Math.floor(time / 1000) > fence;
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
    const findings = states.map(entry => ({ ...entry, state: entry.negativeState || entry.state })).filter(({ state }) => state[section].commit_sha === headSha &&
      (state[section].has_any_findings === true || state[section].has_unresolved_findings === true));
    if (!findings.length) continue;
    const fence = Math.max(...findings.map(({ comment, state, time }) => {
      const completed = codeReviewCompletionTime(comment.body, label, headSha);
      return Math.floor((state[section].status === "completed" && Number.isFinite(completed) && completed <= time + 999 ? completed : time) / 1000);
    }));
    const cleared = states.some(({ comment, state, result, time }) => {
      if (!state) return false;
      const value = state[section];
      const completed = codeReviewCompletionTime(comment.body, label, headSha);
      return hasValidFindingCompanions(state, comment.body, time, headSha, section) && !hasVisibleStructuredConflict(comment.body, section) && value.commit_sha === headSha && value.status === "completed" &&
        value.has_any_findings === false && value.has_unresolved_findings === false &&
        Number.isFinite(completed) && completed <= time + 999 && Math.floor(completed / 1000) > fence;
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
      return value.commit_sha === headSha && value.status === "completed" && value.has_any_findings === false && value.has_unresolved_findings === false && Number.isFinite(time) && time <= observed + 999;
    });
}

function hasFreshCodeReviewCompletion(body, requestMarker, updatedAt) {
  const time = codeReviewCompletionTime(body);
  const cutoff = Date.parse(requestMarker?.sourceCommentCreatedAt || requestMarker?.requestedAt || requestMarker?.commentCreatedAt || "");
  const snapshotTime = Date.parse(updatedAt || "");
  // GitHub comment timestamps have second precision; row times retain fractions.
  return Number.isFinite(time) && Number.isFinite(cutoff) && Number.isFinite(snapshotTime) &&
    Math.floor(time / 1000) > Math.floor(cutoff / 1000) && time <= snapshotTime + 999;
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
        (!hasFreshCodeReviewCompletion(comment.body, requestMarker, reviewEvidenceTime(comment)) ||
         Math.floor(codeReviewCompletionTime(comment.body) / 1000) <= Math.floor(structuredWithdrawalTime / 1000))) return { ...parsed, result: "pending", requiresCodeReceipt: false };
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
      ? new Date(Math.floor(codeReviewCompletionTime(comment.body) / 1000) * 1000).toISOString()
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
