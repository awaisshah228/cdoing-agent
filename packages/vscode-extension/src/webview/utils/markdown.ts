/**
 * markdown.ts — Lightweight Markdown Renderer
 *
 * Converts markdown text to safe HTML for display in messages.
 * Supports: code blocks, inline code, bold, italic, links, lists, blockquotes.
 */

/** Convert markdown to HTML */
export function renderMarkdown(text: string): string {
  let html = text;

  // Escape HTML entities
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const langLabel = lang ? `<span class="code-lang">${lang}</span>` : "";
    return `<div class="code-block">${langLabel}<pre><code>${code.trimEnd()}</code></pre></div>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" title="$2">$1</a>');

  // Unordered list items
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Ordered list items
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  // Paragraphs
  html = html
    .split(/\n\n+/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^<(pre|ul|ol|blockquote|li|div)/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  return html;
}
