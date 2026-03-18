/**
 * Textarea keybindings configuration
 *
 * Maps keyboard shortcuts to textarea actions like cursor movement,
 * selection, word navigation, delete operations, undo/redo, etc.
 */

import type { KeyBinding } from "@opentui/core";

type TextareaAction = KeyBinding["action"];

function kb(
  name: string,
  action: TextareaAction,
  modifiers?: { ctrl?: true; meta?: true; shift?: true },
): KeyBinding {
  return { name, action, ...modifiers };
}

/**
 * All textarea keybindings matching opencode's textarea-keybindings.
 * The <textarea> component handles these actions natively:
 *   submit, newline, move-*, select-*, line-home/end, visual-line-home/end,
 *   buffer-home/end, delete-line, delete-to-line-*, backspace, delete,
 *   undo, redo, word-forward/backward, select-word-*, delete-word-*
 */
export const TEXTAREA_KEYBINDINGS: KeyBinding[] = [
  // ── Submit & Newline ──
  kb("return", "submit"),
  kb("return", "newline", { meta: true }),
  kb("return", "newline", { shift: true }),

  // ── Cursor Movement ──
  kb("left", "move-left"),
  kb("right", "move-right"),
  kb("up", "move-up"),
  kb("down", "move-down"),

  // ── Selection ──
  kb("left", "select-left", { shift: true }),
  kb("right", "select-right", { shift: true }),
  kb("up", "select-up", { shift: true }),
  kb("down", "select-down", { shift: true }),

  // ── Line Home/End ──
  kb("home", "line-home"),
  kb("end", "line-end"),
  kb("a", "line-home", { ctrl: true }),
  kb("e", "line-end", { ctrl: true }),
  kb("home", "select-line-home", { shift: true }),
  kb("end", "select-line-end", { shift: true }),

  // ── Visual Line Home/End (wrapped lines) ──
  kb("left", "visual-line-home", { meta: true }),
  kb("right", "visual-line-end", { meta: true }),
  kb("left", "select-visual-line-home", { meta: true, shift: true }),
  kb("right", "select-visual-line-end", { meta: true, shift: true }),

  // ── Buffer Home/End ──
  kb("home", "buffer-home", { meta: true }),
  kb("end", "buffer-end", { meta: true }),
  kb("up", "buffer-home", { meta: true }),
  kb("down", "buffer-end", { meta: true }),
  kb("home", "select-buffer-home", { meta: true, shift: true }),
  kb("end", "select-buffer-end", { meta: true, shift: true }),
  kb("up", "select-buffer-home", { meta: true, shift: true }),
  kb("down", "select-buffer-end", { meta: true, shift: true }),

  // ── Delete Operations ──
  kb("backspace", "backspace"),
  kb("delete", "delete"),
  kb("d", "delete-line", { ctrl: true }),
  kb("k", "delete-to-line-end", { ctrl: true }),
  kb("u", "delete-to-line-start", { ctrl: true }),

  // ── Undo / Redo ──
  kb("z", "undo", { meta: true }),
  kb("z", "redo", { meta: true, shift: true }),
  kb("z", "undo", { ctrl: true }),
  kb("z", "redo", { ctrl: true, shift: true }),

  // ── Word Navigation ──
  kb("right", "word-forward", { ctrl: true }),
  kb("left", "word-backward", { ctrl: true }),
  kb("f", "word-forward", { meta: true }),
  kb("b", "word-backward", { meta: true }),

  // ── Word Selection ──
  kb("right", "select-word-forward", { ctrl: true, shift: true }),
  kb("left", "select-word-backward", { ctrl: true, shift: true }),
  kb("right", "select-word-forward", { meta: true, shift: true }),
  kb("left", "select-word-backward", { meta: true, shift: true }),

  // ── Word Delete ──
  kb("delete", "delete-word-forward", { ctrl: true }),
  kb("backspace", "delete-word-backward", { ctrl: true }),
  kb("d", "delete-word-forward", { meta: true }),
  kb("backspace", "delete-word-backward", { meta: true }),
  kb("w", "delete-word-backward", { ctrl: true }),

  // ── Select All ──
  kb("a", "select-all", { meta: true }),
];
