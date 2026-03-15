/**
 * Lazy Apply — LLM-assisted placeholder expansion for file edits.
 *
 * When an LLM generates code with placeholder markers like:
 *   // ... existing code ...
 *   // ... rest of the function ...
 *   # ... remaining imports ...
 *
 * This module detects those placeholders and expands them by preserving
 * the corresponding original code sections. This allows LLMs to make
 * targeted edits without reproducing entire files.
 *
 * Three strategies:
 *   1. Deterministic — match anchors (lines before/after placeholder) against
 *      original content and splice in the preserved region
 *   2. Unified diff — if the new content is a diff, apply it directly
 *   3. Streaming — process token-by-token as LLM generates, expanding in real-time
 */

/**
 * Common placeholder patterns used by LLMs to indicate "keep existing code here".
 * Matches patterns like:
 *   // ... existing code ...
 *   // ... rest of the function ...
 *   # ... remaining imports ...
 *   /* ... keep existing ... * /
 *   // [existing code]
 *   // (rest remains the same)
 */
const PLACEHOLDER_PATTERNS = [
  // Comment-style with ellipsis: // ... existing code ...
  /^(\s*)(?:\/\/|#|--|\/\*|\*|<!--)\s*\.{2,}\s*(existing|remaining|rest|keep|same|unchanged|other|previous).*$/i,
  // Comment-style with brackets: // [existing code]
  /^(\s*)(?:\/\/|#|--|\/\*|\*|<!--)\s*\[(?:existing|remaining|rest|keep|same|unchanged|other|previous).*\].*$/i,
  // Comment-style with parens: // (rest remains the same)
  /^(\s*)(?:\/\/|#|--|\/\*|\*|<!--)\s*\((?:existing|remaining|rest|keep|same|unchanged|other|previous).*\).*$/i,
  // Bare ellipsis comment: // ...
  /^(\s*)(?:\/\/|#|--|\/\*|\*|<!--)\s*\.{3,}\s*(?:\*\/|-->)?\s*$/,
];

export interface LazyApplyResult {
  content: string;
  placeholdersExpanded: number;
  strategy: "deterministic" | "none";
}

/**
 * Check if a line is a placeholder marker.
 */
export function isPlaceholderLine(line: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(line));
}

/**
 * Detect if content contains any placeholder markers.
 */
export function hasPlaceholders(content: string): boolean {
  return content.split("\n").some(isPlaceholderLine);
}

/**
 * Expand placeholders in newContent by referencing originalContent.
 *
 * Algorithm:
 * 1. Split both contents into lines
 * 2. Walk through newContent lines
 * 3. When a placeholder line is found:
 *    a. Use anchor lines (the non-placeholder lines before and after) to locate
 *       the corresponding region in the original file
 *    b. Splice in the original lines between the anchors
 * 4. Return the expanded content
 */
export function expandPlaceholders(
  originalContent: string,
  newContent: string,
): LazyApplyResult {
  const newLines = newContent.split("\n");

  if (!newLines.some(isPlaceholderLine)) {
    return { content: newContent, placeholdersExpanded: 0, strategy: "none" };
  }

  const originalLines = originalContent.split("\n");
  const result: string[] = [];
  let placeholdersExpanded = 0;
  let i = 0;

  while (i < newLines.length) {
    if (!isPlaceholderLine(newLines[i])) {
      result.push(newLines[i]);
      i++;
      continue;
    }

    // Found a placeholder — find anchor lines before and after
    const anchorBefore = findAnchorBefore(result);
    const anchorAfter = findAnchorAfter(newLines, i);

    // Locate the region in original content between these anchors
    const region = findOriginalRegion(originalLines, anchorBefore, anchorAfter);

    if (region) {
      // Splice in the original lines
      for (let r = region.start; r < region.end; r++) {
        result.push(originalLines[r]);
      }
      placeholdersExpanded++;
    } else {
      // Couldn't find region — keep placeholder as a comment so it's visible
      result.push(newLines[i]);
    }

    i++;
  }

  return {
    content: result.join("\n"),
    placeholdersExpanded,
    strategy: placeholdersExpanded > 0 ? "deterministic" : "none",
  };
}

/**
 * Find the last non-empty, non-placeholder line from the result so far.
 */
function findAnchorBefore(resultSoFar: string[]): string | null {
  for (let i = resultSoFar.length - 1; i >= 0; i--) {
    const line = resultSoFar[i].trim();
    if (line && !isPlaceholderLine(resultSoFar[i])) {
      return resultSoFar[i];
    }
  }
  return null;
}

/**
 * Find the next non-empty, non-placeholder line after position i.
 */
function findAnchorAfter(lines: string[], fromIndex: number): string | null {
  for (let i = fromIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !isPlaceholderLine(lines[i])) {
      return lines[i];
    }
  }
  return null;
}

/**
 * Find the region in originalLines between anchorBefore and anchorAfter.
 * Returns the line range (exclusive end) of original lines to preserve.
 */
function findOriginalRegion(
  originalLines: string[],
  anchorBefore: string | null,
  anchorAfter: string | null,
): { start: number; end: number } | null {
  let startIdx = 0;
  let endIdx = originalLines.length;

  // Find where anchorBefore occurs in original
  if (anchorBefore !== null) {
    const beforeTrimmed = anchorBefore.trim();
    for (let i = 0; i < originalLines.length; i++) {
      if (originalLines[i].trim() === beforeTrimmed) {
        startIdx = i + 1; // Start after the anchor
        break;
      }
    }
  }

  // Find where anchorAfter occurs in original (searching from startIdx)
  if (anchorAfter !== null) {
    const afterTrimmed = anchorAfter.trim();
    for (let i = startIdx; i < originalLines.length; i++) {
      if (originalLines[i].trim() === afterTrimmed) {
        endIdx = i; // End before the anchor
        break;
      }
    }
  }

  // Validate we found a sensible region
  if (startIdx >= endIdx) {
    return null;
  }

  return { start: startIdx, end: endIdx };
}
