/**
 * Search Match — multi-strategy string matching for file editing.
 *
 * Inspired by Continue's cascading match strategies:
 *   1. Exact match
 *   2. Trimmed match (ignore leading/trailing whitespace)
 *   3. Case-insensitive match
 *   4. Whitespace-ignored match (strips all whitespace, maps back to original positions)
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
  // If trimmed version equals original, exact match would have caught it
  if (trimmed === searchContent) return null;
  const idx = fileContent.indexOf(trimmed);
  if (idx !== -1) {
    // Extend match to include leading whitespace on the same line (preserve indentation context)
    let adjustedStart = idx;
    while (adjustedStart > 0 && fileContent[adjustedStart - 1] !== "\n" &&
           (fileContent[adjustedStart - 1] === " " || fileContent[adjustedStart - 1] === "\t")) {
      adjustedStart--;
    }
    // Only extend if the matched text starts at the beginning of a line
    // (i.e., the whitespace is indentation, not mid-line spaces)
    const isLineStart = adjustedStart === 0 || fileContent[adjustedStart - 1] === "\n";
    const startIdx = isLineStart ? adjustedStart : idx;
    return { startIndex: startIdx, endIndex: idx + trimmed.length, strategyName: "trimmed" };
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

/** 4. Whitespace-ignored match — strips all whitespace, maps positions back */
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

/** 5. Jaro-Winkler fuzzy match — line-based sliding window with 90%+ threshold */
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
  whitespaceIgnoredMatch,
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
    throw new Error(`old_string not found in file (tried exact, trimmed, case-insensitive, and whitespace-ignored matching)`);
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
    // For non-exact strategies, adapt indentation of new_string to match
    // the indentation of the matched region in the original file
    const adjustedNewString = strategy !== "exact"
      ? adaptIndentation(content, m.startIndex, oldString, newString)
      : newString;
    result = result.substring(0, m.startIndex) + adjustedNewString + result.substring(m.endIndex);
  }

  return { result, count: toReplace.length, strategy };
}

/**
 * Adapt the indentation of newString to match the original file's indentation
 * at the match location.
 *
 * Example:
 *   File matched region:   "  function foo() {\n    return 1;\n  }"  (2-space indent)
 *   LLM old_string:        "function foo() {\n  return 1;\n}"        (0-space indent)
 *   LLM new_string:        "function bar() {\n  return 2;\n}"        (0-space indent)
 *   Result:                "  function bar() {\n    return 2;\n  }"  (2-space indent preserved)
 */
function adaptIndentation(
  fileContent: string,
  matchStartIndex: number,
  oldString: string,
  newString: string,
): string {
  // Find the indentation of the first line of the match in the file
  const fileIndent = getLineIndent(fileContent, matchStartIndex);

  // Find the indentation of the first line of old_string (what LLM thinks the indent is)
  const oldIndent = getLeadingWhitespace(oldString);

  // If they're the same, no adjustment needed
  if (fileIndent === oldIndent) return newString;

  // Re-indent every line of new_string:
  // Remove the LLM's assumed indentation and add the file's actual indentation
  const newLines = newString.split("\n");
  const adjustedLines = newLines.map((line, i) => {
    if (i === 0) {
      // First line: strip old indent, add file indent
      const stripped = removeIndentPrefix(line, oldIndent);
      return fileIndent + stripped;
    }
    // Subsequent lines: compute relative indent from old_string, apply to file indent
    const lineIndent = getLeadingWhitespace(line);
    if (lineIndent.startsWith(oldIndent)) {
      // Line has at least the base indent — preserve the extra part
      const extra = lineIndent.substring(oldIndent.length);
      const stripped = line.substring(lineIndent.length);
      return fileIndent + extra + stripped;
    }
    // Line has less indent than base (e.g., closing brace) — adjust proportionally
    const stripped = line.substring(lineIndent.length);
    // If old indent is empty, just prepend file indent
    if (!oldIndent) return fileIndent + line;
    return fileIndent + stripped;
  });

  return adjustedLines.join("\n");
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

/** Remove an indent prefix from a line, if present */
function removeIndentPrefix(line: string, prefix: string): string {
  if (!prefix) return line;
  if (line.startsWith(prefix)) return line.substring(prefix.length);
  // If the line doesn't start with the exact prefix, strip all leading whitespace
  return line.replace(/^[ \t]*/, "");
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
