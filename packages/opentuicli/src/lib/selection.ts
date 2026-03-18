/**
 * Selection utilities — copy selected text from the terminal to clipboard
 *
 * Uses the renderer's global selection API to get mouse-selected text,
 * then writes it to the system clipboard.
 */

import { writeClipboard } from "./clipboard";

type Renderer = {
  getSelection: () => { getSelectedText: () => string } | null;
  clearSelection: () => void;
};

/**
 * Copy the current terminal selection to the system clipboard.
 * Returns true if text was copied, false if nothing was selected.
 */
export function copySelection(
  renderer: Renderer,
  onCopied?: () => void,
  onError?: (err: unknown) => void,
): boolean {
  const text = renderer.getSelection()?.getSelectedText();
  if (!text) return false;

  writeClipboard(text)
    .then(() => onCopied?.())
    .catch((err) => onError?.(err));

  renderer.clearSelection();
  return true;
}
