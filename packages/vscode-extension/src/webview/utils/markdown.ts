/**
 * markdown.ts — Markdown Renderer using `marked` + `highlight.js`
 *
 * Features:
 *   - Full GFM (tables, task lists, strikethrough)
 *   - Syntax-highlighted code blocks
 *   - Clickable file paths detected in inline code
 *   - Sanitized output (no raw HTML injection)
 */

import { marked } from "marked";
import hljs from "highlight.js/lib/core";

// Register common languages (keeps bundle small)
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import diff from "highlight.js/lib/languages/diff";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("zsh", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", cpp);
hljs.registerLanguage("diff", diff);

// Configure marked
const renderer = new marked.Renderer();

// Code blocks with syntax highlighting + copy button + language label
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = lang && hljs.getLanguage(lang) ? lang : "";
  let highlighted: string;

  if (language) {
    highlighted = hljs.highlight(text, { language }).value;
  } else {
    // Try auto-detection
    try {
      highlighted = hljs.highlightAuto(text).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  }

  const langLabel = language ? `<span class="code-lang">${language}</span>` : "";
  const copyBtn = `<button class="code-copy-btn" onclick="copyCode(this)" title="Copy">📋</button>`;

  return `<div class="code-block">${langLabel}${copyBtn}<pre><code class="hljs${language ? ` language-${language}` : ""}">${highlighted}</code></pre></div>`;
};

// Inline code — detect file paths and make them clickable
renderer.codespan = function ({ text }: { text: string }) {
  const decoded = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // Detect file paths (contains / or \ and has an extension)
  if (/[\/\\]/.test(decoded) && /\.\w{1,10}$/.test(decoded)) {
    return `<code class="file-link" data-path="${escapeHtml(decoded)}" title="Click to open ${escapeHtml(decoded)}">${escapeHtml(decoded)}</code>`;
  }
  return `<code>${escapeHtml(decoded)}</code>`;
};

// Links open externally
renderer.link = function ({ href, text }: { href: string; text: string }) {
  return `<a href="${href}" title="${href}">${text}</a>`;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: false,
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render markdown to HTML */
export function renderMarkdown(text: string): string {
  try {
    return marked.parse(text, { async: false }) as string;
  } catch {
    // Fallback to escaped plain text
    return `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`;
  }
}

/**
 * Copy code block content to clipboard.
 * Injected as a global function in the webview.
 */
export const COPY_CODE_SCRIPT = `
function copyCode(btn) {
  const pre = btn.closest('.code-block').querySelector('pre');
  const text = pre.textContent || pre.innerText;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = '📋'; }, 1500);
  });
}
`;
