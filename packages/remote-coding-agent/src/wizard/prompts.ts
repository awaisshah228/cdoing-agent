/**
 * WizardPrompter — Reusable abstraction for interactive setup prompts.
 *
 * Inspired by openclaw's WizardPrompter / @clack/prompts pattern.
 * Provides a clean async/await API for:
 *   - select()   — arrow-key menu
 *   - confirm()  — yes/no
 *   - text()     — free-form input
 *   - password() — masked input
 *   - note()     — informational block
 *   - intro()    — wizard header
 *   - outro()    — wizard footer
 *   - progress() — spinner/progress indicator
 *
 * The default implementation uses readline + ANSI escape codes (no Ink).
 * Can be swapped for a TUI-native implementation by passing a custom prompter.
 */

import * as readline from "readline";

// ── ANSI Colors ──────────────────────────────────────────────────────────

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ── Types ────────────────────────────────────────────────────────────────

export interface SelectOption<T = string> {
  value: T;
  label: string;
  hint?: string;
}

export interface SelectParams<T = string> {
  message: string;
  options: SelectOption<T>[];
  initialValue?: T;
}

export interface ConfirmParams {
  message: string;
  initialValue?: boolean;
}

export interface TextParams {
  message: string;
  initialValue?: string;
  placeholder?: string;
  validate?: (value: string) => string | undefined;
}

export interface PasswordParams {
  message: string;
  validate?: (value: string) => string | undefined;
}

export interface MultiSelectOption<T = string> {
  value: T;
  label: string;
  hint?: string;
  selected?: boolean;
}

export interface MultiSelectParams<T = string> {
  message: string;
  options: MultiSelectOption<T>[];
}

export interface ProgressHandle {
  update(message: string): void;
  stop(doneMessage?: string): void;
}

/**
 * WizardPrompter interface — implement this to provide custom prompt UIs.
 */
export interface WizardPrompter {
  intro(title: string): Promise<void>;
  outro(message: string): Promise<void>;
  note(message: string, title?: string): Promise<void>;
  select<T extends string>(params: SelectParams<T>): Promise<T>;
  multiSelect<T extends string>(params: MultiSelectParams<T>): Promise<T[]>;
  confirm(params: ConfirmParams): Promise<boolean>;
  text(params: TextParams): Promise<string>;
  password(params: PasswordParams): Promise<string>;
  progress(label: string): ProgressHandle;
}

// ── Error ────────────────────────────────────────────────────────────────

export class WizardCancelledError extends Error {
  constructor(reason: string = "cancelled") {
    super(`Setup cancelled: ${reason}`);
    this.name = "WizardCancelledError";
  }
}

// ── Default CLI Implementation ───────────────────────────────────────────

/**
 * Create the default readline-based WizardPrompter.
 */
export function createCliPrompter(): WizardPrompter {
  return {
    async intro(title: string) {
      console.log();
      console.log(`${CYAN}${BOLD}┌─────────────────────────────────────────────┐${RESET}`);
      console.log(`${CYAN}${BOLD}│  ${title.padEnd(43)}│${RESET}`);
      console.log(`${CYAN}${BOLD}└─────────────────────────────────────────────┘${RESET}`);
      console.log();
    },

    async outro(message: string) {
      console.log();
      console.log(`${GREEN}${BOLD}  ${message}${RESET}`);
      console.log();
    },

    async note(message: string, title?: string) {
      console.log();
      if (title) {
        console.log(`${YELLOW}${BOLD}  ${title}${RESET}`);
      }
      for (const line of message.split("\n")) {
        console.log(`${DIM}  ${line}${RESET}`);
      }
      console.log();
    },

    async select<T extends string>(params: SelectParams<T>): Promise<T> {
      const { message, options, initialValue } = params;
      const defaultIdx = initialValue
        ? options.findIndex((o) => o.value === initialValue)
        : 0;

      return new Promise((resolve) => {
        let selected = Math.max(0, defaultIdx);

        const render = (initial: boolean) => {
          if (!initial) {
            // Move cursor up to overwrite previous render
            process.stdout.write(`\x1b[${options.length + 1}A\x1b[J`);
          }
          console.log(`${GREEN}?${RESET} ${BOLD}${message}${RESET}`);
          for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const active = i === selected;
            const prefix = active ? `${CYAN}❯${RESET} ${BOLD}` : "  ";
            const hint = active && opt.hint ? `  ${DIM}${opt.hint}${RESET}` : "";
            const suffix = active ? RESET : "";
            console.log(`${prefix}${opt.label}${suffix}${hint}`);
          }
        };

        render(true);

        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        process.stdin.resume();

        const onKeypress = (_str: string, key: readline.Key) => {
          if (key.name === "up" && selected > 0) {
            selected--;
            render(false);
          } else if (key.name === "down" && selected < options.length - 1) {
            selected++;
            render(false);
          } else if (key.name === "return") {
            cleanup();
            console.log(`${DIM}  Selected: ${options[selected].label}${RESET}`);
            resolve(options[selected].value);
          } else if (key.ctrl && key.name === "c") {
            cleanup();
            throw new WizardCancelledError("user interrupted");
          }
        };

        const cleanup = () => {
          process.stdin.removeListener("keypress", onKeypress);
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdin.pause();
        };

        process.stdin.on("keypress", onKeypress);
      });
    },

    async multiSelect<T extends string>(params: MultiSelectParams<T>): Promise<T[]> {
      const { message, options } = params;
      const selected = new Set<number>(
        options.map((o, i) => (o.selected ? i : -1)).filter((i) => i >= 0),
      );

      return new Promise((resolve) => {
        let cursor = 0;

        const render = (initial: boolean) => {
          if (!initial) {
            process.stdout.write(`\x1b[${options.length + 2}A\x1b[J`);
          }
          console.log(`${GREEN}?${RESET} ${BOLD}${message}${RESET}  ${DIM}(Space toggle, Enter confirm)${RESET}`);
          for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const active = i === cursor;
            const checked = selected.has(i);
            const marker = checked ? `${GREEN}[✓]${RESET}` : `${DIM}[ ]${RESET}`;
            const pointer = active ? `${CYAN}❯${RESET}` : " ";
            const label = active ? `${BOLD}${opt.label}${RESET}` : opt.label;
            const hint = opt.hint ? `  ${DIM}${opt.hint}${RESET}` : "";
            console.log(`${pointer} ${marker} ${label}${hint}`);
          }
          const count = selected.size;
          console.log(`${DIM}  ${count} selected${RESET}`);
        };

        render(true);

        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        process.stdin.resume();

        const onKeypress = (_str: string, key: readline.Key) => {
          if (key.name === "up" && cursor > 0) {
            cursor--;
            render(false);
          } else if (key.name === "down" && cursor < options.length - 1) {
            cursor++;
            render(false);
          } else if (key.name === "space" || (_str === " ")) {
            if (selected.has(cursor)) {
              selected.delete(cursor);
            } else {
              selected.add(cursor);
            }
            render(false);
          } else if (key.name === "return") {
            cleanup();
            const result = Array.from(selected)
              .sort()
              .map((i) => options[i].value);
            const names = Array.from(selected)
              .sort()
              .map((i) => options[i].label)
              .join(", ");
            console.log(`${DIM}  Selected: ${names || "none"}${RESET}`);
            resolve(result);
          } else if (key.ctrl && key.name === "c") {
            cleanup();
            throw new WizardCancelledError("user interrupted");
          } else if (key.ctrl && key.name === "a") {
            // Select all
            for (let i = 0; i < options.length; i++) selected.add(i);
            render(false);
          } else if (key.ctrl && key.name === "d") {
            // Deselect all
            selected.clear();
            render(false);
          }
        };

        const cleanup = () => {
          process.stdin.removeListener("keypress", onKeypress);
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdin.pause();
        };

        process.stdin.on("keypress", onKeypress);
      });
    },

    async confirm(params: ConfirmParams): Promise<boolean> {
      const { message, initialValue = true } = params;
      const hint = initialValue ? "Y/n" : "y/N";
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      return new Promise((resolve) => {
        rl.question(
          `${GREEN}?${RESET} ${BOLD}${message}${RESET} ${DIM}(${hint})${RESET}: `,
          (answer) => {
            rl.close();
            if (!answer.trim()) {
              resolve(initialValue);
            } else {
              resolve(answer.trim().toLowerCase().startsWith("y"));
            }
          },
        );
      });
    },

    async text(params: TextParams): Promise<string> {
      const { message, initialValue, placeholder } = params;
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const hint = initialValue
        ? ` ${DIM}(${initialValue})${RESET}`
        : placeholder
          ? ` ${DIM}(${placeholder})${RESET}`
          : "";

      return new Promise((resolve) => {
        rl.question(`${GREEN}?${RESET} ${BOLD}${message}${RESET}${hint}: `, (answer) => {
          rl.close();
          const value = answer.trim() || initialValue || "";
          if (params.validate) {
            const error = params.validate(value);
            if (error) {
              console.log(`${RED}  ${error}${RESET}`);
              // Re-prompt on validation failure
              resolve(this.text(params));
              return;
            }
          }
          resolve(value);
        });
      });
    },

    async password(params: PasswordParams): Promise<string> {
      const { message } = params;
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Mask input
      const originalWrite = process.stdout.write.bind(process.stdout);
      let masking = false;

      return new Promise((resolve) => {
        process.stdout.write = ((...args: Parameters<typeof originalWrite>) => {
          if (masking && typeof args[0] === "string" && !args[0].includes("?")) {
            return originalWrite("*");
          }
          return originalWrite(...args);
        }) as typeof process.stdout.write;

        masking = true;
        rl.question(`${GREEN}?${RESET} ${BOLD}${message}${RESET}: `, (answer) => {
          masking = false;
          process.stdout.write = originalWrite;
          rl.close();
          console.log(); // newline after masked input
          const value = answer.trim();
          if (params.validate) {
            const error = params.validate(value);
            if (error) {
              console.log(`${RED}  ${error}${RESET}`);
              resolve(this.password(params));
              return;
            }
          }
          resolve(value);
        });
      });
    },

    progress(label: string): ProgressHandle {
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let frameIdx = 0;
      let currentMessage = label;
      let timer: ReturnType<typeof setInterval> | null = null;

      const render = () => {
        process.stdout.write(`\r${CYAN}${frames[frameIdx]}${RESET} ${currentMessage}`);
        frameIdx = (frameIdx + 1) % frames.length;
      };

      timer = setInterval(render, 80);
      render();

      return {
        update(message: string) {
          currentMessage = message;
        },
        stop(doneMessage?: string) {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          process.stdout.write(`\r${GREEN}✓${RESET} ${doneMessage || currentMessage}\n`);
        },
      };
    },
  };
}
