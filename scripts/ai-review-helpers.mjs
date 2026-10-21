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

function withoutAuthorityHtmlBlocks(value, htmlRanges = null) {
  // GFM HTML block classes: raw-text/declaration terminators, then blank-line blocks.
  const blockTags = /^(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)$/i;
  const completeTag = /^ {0,3}<(?:\/[a-z][a-z0-9-]*\s*|[a-z][a-z0-9-]*(?:\s+[a-z_:][a-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?)>[ \t]*$/i;
  let result = "", end = null, blankTerminated = false, offset = 0, detailsDepth = 0, htmlContainer = null;
  for (const line of value.split(/(?<=\n)/)) {
    const context = markdownContainerContext(line);
    if (!end && !blankTerminated && !detailsDepth) htmlContainer = null;
    let content = htmlContainer ? markdownContainerContinuation(line, htmlContainer.frames) : context.content;
    if (content === null) { end = null; blankTerminated = false; detailsDepth = 0; htmlContainer = null; content = context.content; }
    if (blankTerminated && /^\s*$/.test(content)) { end = null; blankTerminated = false; }
    if (!end && !blankTerminated) {
      const raw = content.match(/^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i);
      const block = content.match(/^ {0,3}<\/?([a-z][a-z0-9-]*)(?=[\s/>]|$)/i);
      if (raw) end = new RegExp("</" + raw[1] + "\\s*>", "i");
      else if (/^ {0,3}<!--/.test(content)) end = /-->/;
      else if (/^ {0,3}<\?/.test(content)) end = /\?>/;
      else if (/^ {0,3}<!\[CDATA\[/.test(content)) end = /\]\]>/;
      else if (/^ {0,3}<![A-Z]/.test(content)) end = />/;
      else if ((block && blockTags.test(block[1])) || completeTag.test(content.replace(/\r?\n$/, ""))) blankTerminated = true;
    }
    if ((end || blankTerminated) && !htmlContainer) htmlContainer = context;
    const insideDetails = detailsDepth > 0;
    if (htmlRanges === null && !end) for (const tag of content.matchAll(/<\/?details\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
      if (/^<\//.test(tag[0])) detailsDepth = Math.max(0, detailsDepth - 1); else detailsDepth++;
    }
    const hidden = Boolean(end || blankTerminated || insideDetails || detailsDepth);
    if (hidden && htmlRanges) htmlRanges.push([offset, offset + line.length]);
    offset += line.length;
    result += hidden ? line.replace(/[^\r\n]/g, "") : line;
    if (end?.test(content)) end = null;
  }
  return result;
}

function rawVisibleHtml(value, rawHtml = false) {
  if (rawHtml) value = value.replace(/<\/?[a-z][a-z0-9-]*(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>/gi, tag => {
    if (/^<img\b/i.test(tag)) return tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(value => value !== undefined) || "";
    return /^<\/?(?:summary|details)\b/i.test(tag) ? " " : "";
  });
  return value.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/<(?:\/[a-z][a-z0-9-]*\s*|[a-z][a-z0-9-]*(?:\s+[a-z_:][a-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?)>/gi, tag => {
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
      definitions.add(match[1].trim().replace(/\s+/g, " ").toLowerCase());
      if (hiddenLines) for (let line = index; line <= index + valid.split("\n").length - 1; line++) hiddenLines.add(line);
    }
  }
  return definitions;
}

function visibleMarkdownLinkLabels(value, referenceText = value) {
  const definitions = markdownReferenceDefinitions(referenceText);
  const hiddenLines = new Set(); markdownReferenceDefinitions(value, hiddenLines);
  value = value.split(/\r\n|[\r\n]/).map((line, index) => hiddenLines.has(index) ? "" : line).join("\n");
  const defined = label => definitions.has(label.trim().replace(/\s+/g, " ").toLowerCase());
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

function markdownContainerContext(line) {
  const frames = [];
  while (true) {
    const quote = line.match(/^ {0,3}>[ \t]?/);
    if (quote) { frames.push({ kind: "quote" }); line = line.slice(quote[0].length); continue; }
    const list = line.match(/^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])[ \t]+/);
    if (list) { frames.push({ kind: "list", width: list[0].length }); line = line.slice(list[0].length); continue; }
    return { content: line, frames };
  }
}

function markdownContainerContinuation(line, frames) {
  for (const frame of frames) {
    const prefix = frame.kind === "quote"
      ? line.match(/^ {0,3}>[ \t]?/)
      : line.match(new RegExp("^(?: {" + frame.width + "}|\\t)"));
    if (!prefix) return null;
    line = line.slice(prefix[0].length);
  }
  return line;
}

function markdownContainerContent(line) {
  return markdownContainerContext(line).content;
}

function projectFootnoteDefinitions(value, ranges, inlineDelimiters, htmlStarts) {
  const definitions = [...value.matchAll(/^ {0,3}\[\^([^\[\]\x00-\x20]+)\]:[^\r\n]*(?:(?:\r\n|\r|\n)(?: {2,}|\t)[^\r\n]*)*/gm)]
    .filter(match => !ranges.some(([start, end]) => match.index >= start && match.index < end));
  const key = label => label.toLowerCase();
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
  const comments = [...value.matchAll(/<!--[\s\S]*?(?:-->|$)/g)].map(match => [match.index, match.index + match[0].length]);
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
    if (start > cursor) result += normalizeVisibleFragment(visibleMarkdownLinkLabels(rawVisibleHtml(value.slice(cursor, start)), referenceText));
    const delimiter = inlineDelimiters.get(start) || 0;
    const content = value.slice(Math.max(cursor, start + delimiter), end - delimiter);
    result += htmlStarts.has(start) ? normalizeVisibleFragment(rawVisibleHtml(content, rawBlockRanges.some(([begin, finish]) => start >= begin && start < finish)), rawBlockRanges.some(([begin, finish]) => start >= begin && start < finish)) : content; cursor = end;
  }
  return result + normalizeVisibleFragment(visibleMarkdownLinkLabels(rawVisibleHtml(value.slice(cursor)), referenceText));
}

function renderedLabelAmbiguityText(value) {
  return normalizeVisibleFragment(rawVisibleHtml(String(value || "")));
}

function hasArticleFindingStatement(text) {
  return String(text).replace(/\r\n?/g, "\n").split(/\n[ \t\f\v]*\n/).some(paragraph =>
    [...paragraph.replace(/[ \t\r\n\f\v]+/g, " ").matchAll(/\b[\p{L}]+ +an? +(?:[\p{L}-]+ +)*?(?:issues?|findings?|problems?)\b/giu)]
      .some(match => !/\b(?:no|not|without|zero)\b/i.test(match[0])));
}

function visibleReviewText(value) {
  return literalAwareVisibleText(value);
}

function normalizeVisibleFragment(value, rawHtml = false) {
  return value.replace(rawHtml ? /&#(x[0-9a-f]+|[0-9]+);?/gi : /&#(x[0-9a-f]+|[0-9]+);/gi, (entity, digits) => {
    const point = digits[0].toLowerCase() === "x" ? parseInt(digits.slice(1), 16) : Number(digits);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  }).replace(/&(ZeroWidthSpace|NegativeVeryThinSpace|NegativeThinSpace|NegativeMediumSpace|NegativeThickSpace|NoBreak|zwnj|zwj|lrm|rlm|shy);/g, "").replace(/\p{Default_Ignorable_Code_Point}/gu, "").replace(/&(nbsp|NonBreakingSpace|ensp|emsp|emsp13|emsp14|numsp|puncsp|thinsp|ThinSpace|hairsp|VeryThinSpace|MediumSpace|ThickSpace|Tab|NewLine);/g, " ").replace(/[*`~]/g, "").replace(/_/g, " ");
}

function containsNegativeReviewState(text) {
  const plain = visibleReviewText(text);
  const negativeState = /\b(?:unresolved|incomplete|pending|in[\s./:-]*progress|changes[\s./:-]*requested|fail(?:ed|ure)?|running|queued|cancel(?:led|ed)|error(?:ed)?|blocked|unknown|withdraw(?:n|al|ing)?|revok(?:e|ed|ing)|revocation|retracted|rescinded|rejected|declined|denied|aborted|abandoned|paused|suspended|skipped|stopped|terminated|expired|invalid|unavailable|inconclusive|deferred|unsuccessful|stale|outdated|superseded|waiting|timed[\s./:-]*out|action[\s./:-]*required)\b/i;
  const negatedSuccess = /\b(?:not|never|no[\s./:-]*longer|(?:has|have|had|is|was|were|could|did|does|do)n['’]t|can['’]t|won['’]t|cannot|unable[\s./:-]*to)(?:[\s./:-]*(?:yet|fully|be|been|being|to))*[\s./:-]*(?:complet(?:e|ed)|finish(?:ed)?|approv(?:e|ed)|start(?:ed)?|review(?:ed)?|pass(?:ed)?|valid(?:ate|ated)?|ready|done|success(?:ful(?:ly)?)?|available)\b/i;
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
      /Codex Review:|\b[1-9][0-9]*\s+(?:[a-z-]+\s+)*(?:issues?|findings?|problems?)\b|\bthere\s+(?:is|are)\s+(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b|\bfound\s+(?:an?\b|[1-9]\b|issues\b|(?:(?:[^.!?;\r\n]*?\b(?:and|or|but)\b|[^.!?;\r\n]*?,)\s*)?(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b)/i.test(visibleVerdict) || hasArticleFindingStatement(visibleVerdict)) return { result: "fail", explicitSha: true };
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
  if (rawRows.length !== 1 || [...rawRows[0].matchAll(/<!--[\s\S]*?(?:-->|$)/g)].some(comment => [...comment[0].matchAll(/\|/g)].some(pipe => markdownLinkOpenerAllowed(comment[0], pipe.index)))) return NaN;
  // A rendered code example cannot supply a canonical completion row.
  if ([...String(body).matchAll(/<summary\b(?:[^"'<>]|"[^"]*"|'[^']*')*>([\s\S]*?)<\/summary>/gi)].some(match => renderedLabelAmbiguityText(match[1]).includes(section))) return NaN;
  body = withoutMarkdownFences(withoutAuthorityHtmlBlocks(String(body).replace(/<!--[\s\S]*?(?:-->|$)/g, comment => comment.replace(/[^\r\n]/g, "")))).replace(/^ {1,3}(?=\|)/gm, "");
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

function structuredNegativeTime(comment, headSha) {
  const observed = Date.parse(comment.updated_at || comment.created_at || "");
  const state = parseStructuredCodexSummary(String(comment.body || ""), headSha, true);
  if (!state || hasVisibleStructuredConflict(comment.body) || !hasValidFindingCompanions(state, comment.body, observed, headSha)) return observed;
  const times = [];
  for (const [section, label] of [["code_review", "Code Review"], ["security_review", "Security Review"]]) {
    const value = state[section];
    if (value.commit_sha !== headSha || !(value.has_any_findings === true || value.has_unresolved_findings === true)) continue;
    const completed = codeReviewCompletionTime(comment.body, label, headSha);
    times.push(value.status === "completed" && Number.isFinite(completed) && completed <= observed + 999 ? Math.floor(completed / 1000) * 1000 : observed);
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
  return /<!--\s*codex-/i.test(visible) || containsBlockingSeverity(body, "codex") || containsNegativeReviewState(visible) || /Codex Review:|\b[1-9][0-9]*\s+(?:[a-z-]+\s+)*(?:issues?|findings?|problems?)\b|\bthere\s+(?:is|are)\s+(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b|\bfound\s+(?:an?\b|[1-9]\b|issues\b|(?:(?:[^.!?;\r\n]*?\b(?:and|or|but)\b|[^.!?;\r\n]*?,)\s*)?(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b)/i.test(visibleReviewText(visible)) || hasArticleFindingStatement(visibleReviewText(visible));
}

function isSupersededTypedFinding(comment, snapshots, headSha) {
  const body = String(comment.body || "").trim();
  const state = parseStructuredCodexSummary(String(comment.body || ""), headSha, true);
  if (!state) return false;
  const visible = withoutCodexHelpFooter(body.replace(/^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 .+? -->\s*## Codex Review Summary/s, ""));
  if (containsBlockingSeverity(body, "codex") || containsNegativeReviewState(visible) || /Codex Review:|\b[1-9][0-9]*\s+(?:[a-z-]+\s+)*(?:issues?|findings?|problems?)\b|\bthere\s+(?:is|are)\s+(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b|\bfound\s+(?:an?\b|[1-9]\b|issues\b|(?:(?:[^.!?;\r\n]*?\b(?:and|or|but)\b|[^.!?;\r\n]*?,)\s*)?(?!(?:no|zero|0)\b)[^.!?;\r\n]*?\bissues?\b)/i.test(visibleReviewText(visible)) || hasArticleFindingStatement(visibleReviewText(visible))) return false;
  const observed = Date.parse(comment.updated_at || comment.created_at || "");
  if (!hasValidFindingCompanions(state, body, observed, headSha)) return false;
  const findings = [["code_review", "Code Review"], ["security_review", "Security Review"]].filter(([section]) => state[section].commit_sha === headSha && (state[section].has_any_findings === true || state[section].has_unresolved_findings === true));
  return findings.length > 0 && findings.every(([section, label]) => {
    const completed = codeReviewCompletionTime(body, label, headSha);
    const fence = Math.floor((state[section].status === "completed" && Number.isFinite(completed) && completed <= observed + 999 ? completed : observed) / 1000);
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
  const summaryResults = latestSummaries.filter(comment => !isSupersededTypedFinding(comment, history, headSha)).map((comment) => effectiveCommentResult(comment)?.result || "pending");
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
