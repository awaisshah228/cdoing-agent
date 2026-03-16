/**
 * Search Match — multi-strategy string matching for file editing.
 *
 * Cascading match strategies (inspired by Continue + OpenCode):
 *   1. Exact match
 *   2. Trimmed match (ignore leading/trailing whitespace)
 *   3. Case-insensitive match
 *   4. Block anchor match (Levenshtein-based first/last line anchoring)
 *   5. Whitespace-ignored match (strips all whitespace, maps back to original positions)
 *   6. Indentation-flexible match (normalize indentation levels)
 *   7. Escape-normalized match (handle \n, \t, etc.)
 *   8. Context-aware match (anchor first/last lines, 50% middle similarity)
 *   9. Jaro-Winkler fuzzy match (90%+ threshold)
 *
 * This makes the edit tool far more resilient to LLM formatting differences.
 */

export interface SearchMatchResult {
  startIndex: number;
  endIndex: number;
  strategyName: string;
}

type MatchStrategy = (fileContent: string, searchContent: string) => SearchMatchResult | null;

/** 1. Exact string match */
function exactMatch(fileContent: string, searchContent: string): SearchMatchResult | null {
  const idx = fileContent.indexOf(searchContent);
  if (idx !== -1) {
    return { startIndex: idx, endIndex: idx + searchContent.length, strategyName: "exact" };
  }
  return null;
}

/** 2. Trimmed match — ignore leading/trailing whitespace */
function trimmedMatch(fileContent: string, searchContent: string): SearchMatchResult | null {
  const trimmed = searchContent.trim();
  if (!trimmed) return null;
  if (trimmed === searchContent) return null;
  const idx = fileContent.indexOf(trimmed);
  if (idx !== -1) {
    return { startIndex: idx, endIndex: idx + trimmed.length, strategyName: "trimmed" };
  }
  return null;
}

/** 3. Case-insensitive match */
function caseInsensitiveMatch(fileContent: string, searchContent: string): SearchMatchResult | null {
  const idx = fileContent.toLowerCase().indexOf(searchContent.toLowerCase());
  if (idx !== -1) {
    return { startIndex: idx, endIndex: idx + searchContent.length, strategyName: "caseInsensitive" };
  }
  return null;
}

// ── Levenshtein distance (used by block anchor strategy) ──────────────────

function levenshtein(a: string, b: string): number {
  if (a === "" || b === "") return Math.max(a.length, b.length);
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

/**
 * 4. Block anchor match — match first/last lines as anchors, use Levenshtein
 * similarity for the middle content. This handles cases where the LLM gets
 * the first and last lines right but the middle content drifts slightly.
 */
function blockAnchorMatch(fileContent: string, searchContent: string): SearchMatchResult | null {
  const searchLines = searchContent.split("\n");
  if (searchLines.length < 3) return null;
  // Remove trailing empty line
  if (searchLines[searchLines.length - 1] === "") searchLines.pop();
  if (searchLines.length < 3) return null;

  const fileLines = fileContent.split("\n");
  const firstLineSearch = searchLines[0].trim();
  const lastLineSearch = searchLines[searchLines.length - 1].trim();

  // Collect candidate positions where both anchors match
  const candidates: Array<{ startLine: number; endLine: number }> = [];
  for (let i = 0; i < fileLines.length; i++) {
    if (fileLines[i].trim() !== firstLineSearch) continue;
    for (let j = i + 2; j < fileLines.length; j++) {
      if (fileLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j });
        break;
      }
    }
  }
  if (candidates.length === 0) return null;

  const SINGLE_THRESHOLD = 0.0;
  const MULTI_THRESHOLD = 0.3;

  function computeSimilarity(startLine: number, endLine: number): number {
    const actualBlockSize = endLine - startLine + 1;
    const linesToCheck = Math.min(searchLines.length - 2, actualBlockSize - 2);
    if (linesToCheck <= 0) return 1.0;
    let similarity = 0;
    for (let j = 1; j < searchLines.length - 1 && j < actualBlockSize - 1; j++) {
      const originalLine = fileLines[startLine + j].trim();
      const searchLine = searchLines[j].trim();
      const maxLen = Math.max(originalLine.length, searchLine.length);
      if (maxLen === 0) continue;
      similarity += (1 - levenshtein(originalLine, searchLine) / maxLen) / linesToCheck;
    }
    return similarity;
  }

  let bestCandidate: { startLine: number; endLine: number } | null = null;
  if (candidates.length === 1) {
    const sim = computeSimilarity(candidates[0].startLine, candidates[0].endLine);
    if (sim >= SINGLE_THRESHOLD) bestCandidate = candidates[0];
  } else {
    let maxSim = -1;
    for (const c of candidates) {
      const sim = computeSimilarity(c.startLine, c.endLine);
      if (sim > maxSim) { maxSim = sim; bestCandidate = c; }
    }
    if (maxSim < MULTI_THRESHOLD) bestCandidate = null;
  }

  if (!bestCandidate) return null;

  // Convert line positions to character indices
  let startIdx = 0;
  for (let k = 0; k < bestCandidate.startLine; k++) startIdx += fileLines[k].length + 1;
  let endIdx = startIdx;
  for (let k = bestCandidate.startLine; k <= bestCandidate.endLine; k++) {
    endIdx += fileLines[k].length;
    if (k < bestCandidate.endLine) endIdx += 1;
  }

  return { startIndex: startIdx, endIndex: endIdx, strategyName: "blockAnchor" };
}

/** 5. Whitespace-ignored match — strips all whitespace, maps positions back */
function whitespaceIgnoredMatch(fileContent: string, searchContent: string): SearchMatchResult | null {
  const strippedFile = fileContent.replace(/\s/g, "");
  const strippedSearch = searchContent.replace(/\s/g, "");

  if (!strippedSearch) return null;

  const strippedIdx = strippedFile.indexOf(strippedSearch);
  if (strippedIdx === -1) return null;

  // Map stripped position back to original
  let originalStart = -1;
  let nonWsCount = 0;

  for (let i = 0; i < fileContent.length; i++) {
    if (!/\s/.test(fileContent[i])) {
      if (nonWsCount === strippedIdx) {
        originalStart = i;
        break;
      }
      nonWsCount++;
    }
  }

  if (originalStart === -1) return null;

  // Find end position
  let originalEnd = originalStart;
  let matchedChars = 0;

  for (let i = originalStart; i < fileContent.length; i++) {
    if (!/\s/.test(fileContent[i])) {
      matchedChars++;
      if (matchedChars === strippedSearch.length) {
        originalEnd = i + 1;
        break;
      }
    }
    originalEnd = i + 1;
  }

  return { startIndex: originalStart, endIndex: originalEnd, strategyName: "whitespaceIgnored" };
}

/**
 * 6. Indentation-flexible match — normalize indentation levels.
 * Handles cases where the LLM produces correct code but with different indentation depth.
 */
function indentationFlexibleMatch(fileContent: string, searchContent: string): SearchMatchResult | null {
  const removeIndentation = (text: string) => {
    const lines = text.split("\n");
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    if (nonEmptyLines.length === 0) return text;
    const minIndent = Math.min(
      ...nonEmptyLines.map((l) => { const m = l.match(/^(\s*)/); return m ? m[1].length : 0; }),
    );
    return lines.map((l) => (l.trim().length === 0 ? l : l.slice(minIndent))).join("\n");
  };

  const normalizedSearch = removeIndentation(searchContent);
  const fileLines = fileContent.split("\n");
  const searchLines = searchContent.split("\n");

  for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
    const block = fileLines.slice(i, i + searchLines.length).join("\n");
    if (removeIndentation(block) === normalizedSearch) {
      const before = fileLines.slice(0, i).join("\n");
      const startIndex = before.length + (i > 0 ? 1 : 0);
      return { startIndex, endIndex: startIndex + block.length, strategyName: "indentationFlexible" };
    }
  }
  return null;
}

/**
 * 7. Escape-normalized match — handle escaped characters (\n, \t, etc.).
 * LLMs sometimes produce escaped sequences instead of literal characters.
 */
function escapeNormalizedMatch(fileContent: string, searchContent: string): SearchMatchResult | null {
  const unescape = (str: string): string =>
    str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, ch) => {
      switch (ch) {
        case "n": return "\n";
        case "t": return "\t";
        case "r": return "\r";
        case "'": return "'";
        case '"': return '"';
        case "`": return "`";
        case "\\": return "\\";
        case "\n": return "\n";
        case "$": return "$";
        default: return match;
      }
    });

  const unescaped = unescape(searchContent);
  if (unescaped === searchContent) return null; // No escapes to normalize

  const idx = fileContent.indexOf(unescaped);
  if (idx !== -1) {
    return { startIndex: idx, endIndex: idx + unescaped.length, strategyName: "escapeNormalized" };
  }

  // Try finding escaped content in file that matches unescaped search
  const fileLines = fileContent.split("\n");
  const searchLines = unescaped.split("\n");
  for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
    const block = fileLines.slice(i, i + searchLines.length).join("\n");
    if (unescape(block) === unescaped) {
      const before = fileLines.slice(0, i).join("\n");
      const startIndex = before.length + (i > 0 ? 1 : 0);
      return { startIndex, endIndex: startIndex + block.length, strategyName: "escapeNormalized" };
    }
  }
  return null;
}

/**
 * 8. Context-aware match — use first/last lines as context anchors,
 * with 50% middle-line similarity threshold. Less strict than block anchor.
 */
function contextAwareMatch(fileContent: string, searchContent: string): SearchMatchResult | null {
  const searchLines = searchContent.split("\n");
  if (searchLines.length < 3) return null;
  if (searchLines[searchLines.length - 1] === "") searchLines.pop();
  if (searchLines.length < 3) return null;

  const fileLines = fileContent.split("\n");
  const firstLine = searchLines[0].trim();
  const lastLine = searchLines[searchLines.length - 1].trim();

  for (let i = 0; i < fileLines.length; i++) {
    if (fileLines[i].trim() !== firstLine) continue;
    for (let j = i + 2; j < fileLines.length; j++) {
      if (fileLines[j].trim() !== lastLine) continue;
      const blockLines = fileLines.slice(i, j + 1);
      if (blockLines.length !== searchLines.length) break;

      let matchingLines = 0;
      let totalNonEmpty = 0;
      for (let k = 1; k < blockLines.length - 1; k++) {
        const bl = blockLines[k].trim();
        const sl = searchLines[k].trim();
        if (bl.length > 0 || sl.length > 0) {
          totalNonEmpty++;
          if (bl === sl) matchingLines++;
        }
      }
      if (totalNonEmpty === 0 || matchingLines / totalNonEmpty >= 0.5) {
        const before = fileLines.slice(0, i).join("\n");
        const startIndex = before.length + (i > 0 ? 1 : 0);
        const block = blockLines.join("\n");
        return { startIndex, endIndex: startIndex + block.length, strategyName: "contextAware" };
      }
      break;
    }
  }
  return null;
}

/** 9. Jaro-Winkler fuzzy match — line-based sliding window with 90%+ threshold */
function fuzzyMatch(fileContent: string, searchContent: string): SearchMatchResult | null {
  const searchBlock = searchContent.trim();
  if (searchBlock.length < 10) return null; // Too short for meaningful fuzzy match

  const searchLines = searchBlock.split("\n");
  const fileLines = fileContent.split("\n");
  if (searchLines.length > fileLines.length) return null;

  let bestMatch: SearchMatchResult | null = null;
  let bestSimilarity = 0;
  const threshold = 0.9;

  // Sliding window of searchLines.length over fileLines
  for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
    const candidate = fileLines.slice(i, i + searchLines.length).join("\n").trim();
    if (candidate.length < 5) continue;

    const similarity = jaroWinklerSimilarity(searchBlock, candidate);
    if (similarity >= threshold && similarity > bestSimilarity) {
      const before = fileLines.slice(0, i).join("\n");
      const startIndex = before.length + (i > 0 ? 1 : 0);
      bestMatch = {
        startIndex,
        endIndex: startIndex + candidate.length,
        strategyName: "fuzzy",
      };
      bestSimilarity = similarity;
    }
  }

  return bestMatch;
}

function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1.length || !s2.length) return 0.0;

  const matchDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  if (matchDist < 0) return 0.0;

  const s1m = new Array(s1.length).fill(false);
  const s2m = new Array(s2.length).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const lo = Math.max(0, i - matchDist);
    const hi = Math.min(i + matchDist + 1, s2.length);
    for (let j = lo; j < hi; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue;
      s1m[i] = s2m[j] = true;
      matches++;
      break;
    }
  }

  if (!matches) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1m[i]) continue;
    while (!s2m[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinklerSimilarity(s1: string, s2: string): number {
  const jaro = jaroSimilarity(s1, s2);
  if (jaro < 0.7) return jaro;
  let prefix = 0;
  const max = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < max; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

const strategies: MatchStrategy[] = [
  exactMatch,
  trimmedMatch,
  caseInsensitiveMatch,
  blockAnchorMatch,
  whitespaceIgnoredMatch,
  indentationFlexibleMatch,
  escapeNormalizedMatch,
  contextAwareMatch,
  fuzzyMatch,
];

/**
 * Find a match for searchContent in fileContent using cascading strategies.
 * Returns null if no strategy matches.
 */
export function findSearchMatch(fileContent: string, searchContent: string): SearchMatchResult | null {
  if (!searchContent.trim()) {
    return { startIndex: 0, endIndex: 0, strategyName: "empty" };
  }

  for (const strategy of strategies) {
    const result = strategy(fileContent, searchContent);
    if (result) return result;
  }

  return null;
}

/**
 * Find all matches for searchContent in fileContent.
 */
export function findAllSearchMatches(fileContent: string, searchContent: string): SearchMatchResult[] {
  if (!searchContent.trim()) {
    return [{ startIndex: 0, endIndex: 0, strategyName: "empty" }];
  }

  const matches: SearchMatchResult[] = [];
  let remaining = fileContent;
  let offset = 0;

  while (remaining.length > 0) {
    const match = findSearchMatch(remaining, searchContent);
    if (!match) break;

    const adjusted: SearchMatchResult = {
      startIndex: match.startIndex + offset,
      endIndex: match.endIndex + offset,
      strategyName: match.strategyName,
    };

    // Prevent infinite loops
    if (matches.length > 0 && adjusted.startIndex <= matches[matches.length - 1].startIndex) break;

    matches.push(adjusted);
    offset = adjusted.endIndex;
    remaining = fileContent.slice(offset);
  }

  return matches;
}

/**
 * Execute a single find-and-replace on content.
 * Uses multi-strategy matching. Returns the new content.
 * Throws if match not found or multiple matches without replace_all.
 *
 * When a non-exact strategy is used, indentation is automatically
 * adjusted so that new_string matches the file's original indentation
 * rather than whatever the LLM happened to produce.
 */
export function executeFindAndReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): { result: string; count: number; strategy: string } {
  if (oldString === newString) {
    throw new Error("old_string and new_string are identical — no change needed");
  }

  const matches = findAllSearchMatches(content, oldString);

  if (matches.length === 0) {
    throw new Error(`old_string not found in file (tried exact, trimmed, case-insensitive, block-anchor, whitespace-ignored, indentation-flexible, escape-normalized, context-aware, and fuzzy matching)`);
  }

  if (!replaceAll && matches.length > 1) {
    throw new Error(`Multiple matches found (${matches.length}). Use replace_all or add more surrounding context to make old_string unique.`);
  }

  const toReplace = replaceAll ? matches : [matches[0]];
  const strategy = matches[0].strategyName;

  // Apply replacements in reverse order to preserve positions
  let result = content;
  for (let i = toReplace.length - 1; i >= 0; i--) {
    const m = toReplace[i];
    const adjustedNewString = normalizeIndentation(content, m.startIndex, oldString, newString, strategy === "exact");
    result = result.substring(0, m.startIndex) + adjustedNewString + result.substring(m.endIndex);
  }

  return { result, count: toReplace.length, strategy };
}

/**
 * Normalize indentation of new_string so it matches the file's context.
 *
 * The key idea: preserve the RELATIVE indentation within new_string,
 * but set the BASE indentation to match the target (the file's actual
 * indentation at the match point).
 *
 * Example:
 *   File:       "  update: (id, data) => {\n    return id;\n  }"   (base: 2 spaces)
 *   new_string: "      modifyItem: (id, data) => {\n        return id;\n      }"  (base: 6 spaces)
 *   Result:     "  modifyItem: (id, data) => {\n    return id;\n  }"  (base: 2 spaces, relative preserved)
 */
function normalizeIndentation(
  fileContent: string,
  matchStartIndex: number,
  _oldString: string,
  newString: string,
  _isExact: boolean,
): string {
  // Get the full line indentation at the match point in the file
  const fileLineIndent = getLineIndent(fileContent, matchStartIndex);

  // How much of that indent is BEFORE matchStartIndex?
  // (already in the file, outside the matched range — it stays in the output)
  //
  // For exact match: match includes the indent → preMatchIndent = ""
  // For trimmed match: match starts after indent → preMatchIndent = fileLineIndent
  const lineStartPos = matchStartIndex - fileLineIndent.length;
  const preMatchIndent = fileContent.substring(lineStartPos, matchStartIndex);

  // The first line of the replacement needs LESS indent because preMatchIndent
  // is already in the file before the insertion point.
  // Subsequent lines start on fresh lines (after \n) — they need the full indent.
  const firstLineTargetIndent = fileLineIndent.substring(preMatchIndent.length);

  // What base indentation does new_string currently have?
  const newBaseIndent = getLeadingWhitespace(newString);

  // If first-line target already matches new_string's base, no adjustment needed
  if (firstLineTargetIndent === newBaseIndent) return newString;

  // Re-indent every line: strip newBaseIndent, prepend the correct target indent.
  const lines = newString.split("\n");
  const adjusted = lines.map((line, i) => {
    const lineIndent = getLeadingWhitespace(line);
    const content = line.substring(lineIndent.length);

    // Empty/whitespace-only lines: keep as-is
    if (!content) return line;

    // Compute relative indent (how much deeper than new_string's base)
    let relativeIndent = "";
    if (lineIndent.length >= newBaseIndent.length && lineIndent.startsWith(newBaseIndent)) {
      relativeIndent = lineIndent.substring(newBaseIndent.length);
    }

    // First line: use firstLineTargetIndent (accounts for pre-match whitespace already in file)
    // Subsequent lines: use full fileLineIndent (they start on fresh lines after \n)
    const baseIndent = i === 0 ? firstLineTargetIndent : fileLineIndent;

    return baseIndent + relativeIndent + content;
  });

  return adjusted.join("\n");
}

/** Get the indentation (leading whitespace) at a position in the file */
function getLineIndent(content: string, position: number): string {
  // Walk backwards to find the start of the line
  let lineStart = position;
  while (lineStart > 0 && content[lineStart - 1] !== "\n") {
    lineStart--;
  }
  // Extract leading whitespace from line start to the first non-whitespace
  let indent = "";
  for (let i = lineStart; i < content.length && (content[i] === " " || content[i] === "\t"); i++) {
    indent += content[i];
  }
  return indent;
}

/** Get leading whitespace of a string's first line */
function getLeadingWhitespace(text: string): string {
  const match = text.match(/^([ \t]*)/);
  return match ? match[1] : "";
}


/**
 * Execute multiple sequential find-and-replace operations.
 * Each edit operates on the result of the previous one.
 * Atomic: if any edit fails, none are applied (throws).
 */
export function executeMultiFindAndReplace(
  content: string,
  edits: Array<{ old_string: string; new_string: string; replace_all?: boolean }>,
): { result: string; totalCount: number } {
  let current = content;
  let totalCount = 0;

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    try {
      const { result, count } = executeFindAndReplace(
        current,
        edit.old_string,
        edit.new_string,
        edit.replace_all ?? false,
      );
      current = result;
      totalCount += count;
    } catch (err) {
      throw new Error(`Edit ${i + 1}/${edits.length} failed: ${(err as Error).message}`);
    }
  }

  return { result: current, totalCount };
}

// ── Unified Diff Application ────────────────────────────────────────────────

/**
 * Check if a string looks like a unified diff format.
 */
export function isUnifiedDiff(text: string): boolean {
  return /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m.test(text);
}

/**
 * Apply a unified diff to file content.
 * Supports standard @@ -n,m +n,m @@ hunk headers.
 * Tolerates minor whitespace differences in context lines.
 */
export function applyUnifiedDiff(originalContent: string, diff: string): string {
  const lines = diff.split("\n");
  const sourceLines = originalContent.split("\n");
  const resultLines = [...sourceLines];

  // Parse hunks
  const hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: Array<{ type: "context" | "add" | "remove"; text: string }>;
  }> = [];

  let currentHunk: typeof hunks[0] | null = null;

  for (const line of lines) {
    // Skip file headers
    if (line.startsWith("---") || line.startsWith("+++")) continue;

    // Parse hunk header
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: parseInt(hunkMatch[2] ?? "1", 10),
        newStart: parseInt(hunkMatch[3], 10),
        newCount: parseInt(hunkMatch[4] ?? "1", 10),
        lines: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("+")) {
      currentHunk.lines.push({ type: "add", text: line.substring(1) });
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ type: "remove", text: line.substring(1) });
    } else if (line.startsWith(" ") || line === "") {
      currentHunk.lines.push({ type: "context", text: line.startsWith(" ") ? line.substring(1) : line });
    }
  }

  if (currentHunk) hunks.push(currentHunk);

  if (hunks.length === 0) {
    throw new Error("No valid hunks found in diff");
  }

  // Apply hunks in reverse order to preserve line numbers
  for (let h = hunks.length - 1; h >= 0; h--) {
    const hunk = hunks[h];
    const startLine = hunk.oldStart - 1; // Convert to 0-based

    // Collect removals and additions
    const toRemove: number[] = [];
    const toAdd: string[] = [];
    let lineIdx = startLine;

    for (const dl of hunk.lines) {
      if (dl.type === "remove") {
        toRemove.push(lineIdx);
        lineIdx++;
      } else if (dl.type === "add") {
        toAdd.push(dl.text);
      } else {
        // context
        lineIdx++;
      }
    }

    // Remove lines (reverse order)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      resultLines.splice(toRemove[i], 1);
    }

    // Insert new lines at the position of first removal (or startLine if no removals)
    const insertAt = toRemove.length > 0 ? toRemove[0] : startLine;
    resultLines.splice(insertAt, 0, ...toAdd);
  }

  return resultLines.join("\n");
}
