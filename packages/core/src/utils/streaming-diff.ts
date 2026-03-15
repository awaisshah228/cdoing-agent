/**
 * Streaming Diff — generates and emits diff chunks in real-time as edits are applied.
 *
 * Instead of computing the entire diff at once and returning it,
 * StreamingDiff emits line-level diff events via a callback, enabling
 * UIs to render changes incrementally (e.g., green/red highlighting as
 * each hunk is processed).
 *
 * Supports three strategies:
 *   1. Deterministic — line-by-line Myers diff (always correct, synchronous)
 *   2. Unified diff — parse and stream hunk-by-hunk from a unified diff string
 *   3. Streaming — emit chunks as they arrive from an LLM token stream
 */

export interface DiffChunk {
  type: "context" | "add" | "remove" | "hunk-header" | "file-header";
  content: string;
  lineNumber?: number;
}

export type DiffChunkCallback = (chunk: DiffChunk) => void;

/**
 * Compute a line-level diff between two strings and emit chunks via callback.
 * Uses a simple LCS-based diff algorithm.
 */
export function streamDeterministicDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
  onChunk: DiffChunkCallback,
): void {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Emit file headers
  onChunk({ type: "file-header", content: `--- a/${filePath}` });
  onChunk({ type: "file-header", content: `+++ b/${filePath}` });

  // Compute LCS for line-level diff
  const diff = computeLineDiff(oldLines, newLines);

  // Group into hunks
  const hunks = groupIntoHunks(diff, oldLines.length, newLines.length);

  for (const hunk of hunks) {
    onChunk({
      type: "hunk-header",
      content: `@@ -${hunk.oldStart + 1},${hunk.oldCount} +${hunk.newStart + 1},${hunk.newCount} @@`,
    });

    for (const entry of hunk.entries) {
      onChunk(entry);
    }
  }
}

interface DiffEntry {
  type: "context" | "add" | "remove";
  content: string;
  oldLine?: number;
  newLine?: number;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  entries: DiffChunk[];
}

/**
 * Simple line diff using longest common subsequence.
 */
function computeLineDiff(oldLines: string[], newLines: string[]): DiffEntry[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffEntry[] = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "context", content: oldLines[i - 1], oldLine: i, newLine: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "add", content: newLines[j - 1], newLine: j });
      j--;
    } else {
      result.unshift({ type: "remove", content: oldLines[i - 1], oldLine: i });
      i--;
    }
  }

  return result;
}

/**
 * Group diff entries into hunks with context lines.
 */
function groupIntoHunks(diff: DiffEntry[], oldTotal: number, newTotal: number, contextLines: number = 3): Hunk[] {
  if (diff.length === 0) return [];

  // Find ranges of changes
  const changeIndices: number[] = [];
  for (let i = 0; i < diff.length; i++) {
    if (diff[i].type !== "context") {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) return [];

  // Group changes that are within contextLines*2 of each other
  const groups: Array<{ start: number; end: number }> = [];
  let groupStart = changeIndices[0];
  let groupEnd = changeIndices[0];

  for (let i = 1; i < changeIndices.length; i++) {
    if (changeIndices[i] - groupEnd <= contextLines * 2 + 1) {
      groupEnd = changeIndices[i];
    } else {
      groups.push({ start: groupStart, end: groupEnd });
      groupStart = changeIndices[i];
      groupEnd = changeIndices[i];
    }
  }
  groups.push({ start: groupStart, end: groupEnd });

  // Build hunks with context
  const hunks: Hunk[] = [];
  for (const group of groups) {
    const hunkStart = Math.max(0, group.start - contextLines);
    const hunkEnd = Math.min(diff.length - 1, group.end + contextLines);

    const entries: DiffChunk[] = [];
    let oldStart = Infinity, newStart = Infinity;
    let oldCount = 0, newCount = 0;

    for (let i = hunkStart; i <= hunkEnd; i++) {
      const d = diff[i];
      const lineNum = d.oldLine ?? d.newLine;

      if (d.type === "context") {
        entries.push({ type: "context", content: ` ${d.content}`, lineNumber: lineNum });
        if (d.oldLine !== undefined && d.oldLine < oldStart) oldStart = d.oldLine;
        if (d.newLine !== undefined && d.newLine < newStart) newStart = d.newLine;
        oldCount++;
        newCount++;
      } else if (d.type === "remove") {
        entries.push({ type: "remove", content: `-${d.content}`, lineNumber: d.oldLine });
        if (d.oldLine !== undefined && d.oldLine < oldStart) oldStart = d.oldLine;
        oldCount++;
      } else {
        entries.push({ type: "add", content: `+${d.content}`, lineNumber: d.newLine });
        if (d.newLine !== undefined && d.newLine < newStart) newStart = d.newLine;
        newCount++;
      }
    }

    if (oldStart === Infinity) oldStart = 1;
    if (newStart === Infinity) newStart = 1;

    hunks.push({
      oldStart: oldStart - 1,
      oldCount,
      newStart: newStart - 1,
      newCount,
      entries,
    });
  }

  return hunks;
}

/**
 * Stream a unified diff string hunk-by-hunk via callback.
 */
export function streamUnifiedDiff(diffText: string, onChunk: DiffChunkCallback): void {
  const lines = diffText.split("\n");

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++")) {
      onChunk({ type: "file-header", content: line });
    } else if (line.startsWith("@@")) {
      onChunk({ type: "hunk-header", content: line });
    } else if (line.startsWith("+")) {
      onChunk({ type: "add", content: line });
    } else if (line.startsWith("-")) {
      onChunk({ type: "remove", content: line });
    } else {
      onChunk({ type: "context", content: line });
    }
  }
}

/**
 * StreamingDiffAccumulator — collects tokens from an LLM stream and emits
 * diff chunks as complete lines are formed. Used for real-time diff display
 * while the model is still generating.
 */
export class StreamingDiffAccumulator {
  private buffer: string = "";
  private onChunk: DiffChunkCallback;
  private lineNumber: number = 1;

  constructor(onChunk: DiffChunkCallback) {
    this.onChunk = onChunk;
  }

  /** Feed a token from the LLM stream */
  addToken(token: string): void {
    this.buffer += token;

    // Emit complete lines
    while (this.buffer.includes("\n")) {
      const newlineIdx = this.buffer.indexOf("\n");
      const line = this.buffer.substring(0, newlineIdx);
      this.buffer = this.buffer.substring(newlineIdx + 1);
      this.emitLine(line);
    }
  }

  /** Flush any remaining content */
  flush(): void {
    if (this.buffer.length > 0) {
      this.emitLine(this.buffer);
      this.buffer = "";
    }
  }

  private emitLine(line: string): void {
    if (line.startsWith("---") || line.startsWith("+++")) {
      this.onChunk({ type: "file-header", content: line });
    } else if (line.startsWith("@@")) {
      this.onChunk({ type: "hunk-header", content: line });
    } else if (line.startsWith("+")) {
      this.onChunk({ type: "add", content: line, lineNumber: this.lineNumber++ });
    } else if (line.startsWith("-")) {
      this.onChunk({ type: "remove", content: line, lineNumber: this.lineNumber++ });
    } else {
      this.onChunk({ type: "context", content: line, lineNumber: this.lineNumber++ });
    }
  }
}
