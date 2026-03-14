/**
 * Problems Context Provider — @problems
 *
 * Injects VS Code diagnostics (errors, warnings) into the conversation.
 * Helps the AI understand what's broken without the user copying error messages.
 *
 * How it works:
 *   1. VS Code extension collects diagnostics from all open files
 *   2. Groups them by file and severity
 *   3. Formats as a structured list for the LLM
 *
 * Learning note: Diagnostics come from VS Code's Language Server Protocol (LSP).
 * Each diagnostic has a file path, line number, severity, and message.
 * We pass them via the `options.diagnostics` array from the extension host.
 */

import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

/** Emoji icons for each severity level */
const SEVERITY_ICONS: Record<string, string> = {
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
  hint: "💡",
};

/** Priority order for sorting (errors first) */
const SEVERITY_ORDER: Record<string, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

export class ProblemsContextProvider implements ContextProvider {
  id = "problems";
  trigger = "@problems";
  description = "Include current file diagnostics (errors, warnings)";
  requiresArg = false;

  async resolve(_arg?: string, options?: ContextResolveOptions): Promise<ContextResult> {
    const diagnostics = options?.diagnostics || [];

    if (diagnostics.length === 0) {
      return {
        label: "Problems",
        content: "[No diagnostics found. All files are clean!]",
        metadata: { source: "diagnostics", itemCount: 0 },
      };
    }

    // Sort by severity (errors first), then by file path
    const sorted = [...diagnostics].sort((a, b) => {
      const severityDiff = (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4);
      if (severityDiff !== 0) return severityDiff;
      return a.file.localeCompare(b.file);
    });

    // Group diagnostics by file for cleaner formatting
    const byFile = new Map<string, typeof diagnostics>();
    for (const diag of sorted) {
      const existing = byFile.get(diag.file) || [];
      existing.push(diag);
      byFile.set(diag.file, existing);
    }

    // Count by severity
    const counts = { error: 0, warning: 0, info: 0, hint: 0 };
    for (const diag of sorted) {
      counts[diag.severity] = (counts[diag.severity] || 0) + 1;
    }

    // Format output
    const sections: string[] = [];
    for (const [file, diags] of byFile) {
      const lines = diags.map((d) => {
        const icon = SEVERITY_ICONS[d.severity] || "•";
        return `  ${icon} Line ${d.line}: ${d.message}`;
      });
      sections.push(`### ${file}\n${lines.join("\n")}`);
    }

    // Build summary line
    const summaryParts: string[] = [];
    if (counts.error > 0) summaryParts.push(`${counts.error} error${counts.error > 1 ? "s" : ""}`);
    if (counts.warning > 0) summaryParts.push(`${counts.warning} warning${counts.warning > 1 ? "s" : ""}`);
    if (counts.info > 0) summaryParts.push(`${counts.info} info`);
    if (counts.hint > 0) summaryParts.push(`${counts.hint} hint${counts.hint > 1 ? "s" : ""}`);
    const summary = summaryParts.join(", ");

    return {
      label: `Problems (${summary})`,
      content: `## Diagnostics: ${summary}\n\n${sections.join("\n\n")}`,
      metadata: {
        source: "diagnostics",
        itemCount: diagnostics.length,
      },
    };
  }
}
