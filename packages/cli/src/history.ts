/**
 * Conversation History Manager
 *
 * Saves conversations to ~/.cdoing/conversations/ as JSON files.
 * Each conversation has an ID, title (from first message), timestamps,
 * and the full message log.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import chalk from "chalk";

const CONV_DIR = path.join(os.homedir(), ".cdoing", "conversations");

/** A single message in the conversation log */
export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  timestamp: number;
}

/** Metadata + messages for a saved conversation */
export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model: string;
  messages: ChatMessage[];
}

/** Make sure the conversations directory exists */
function ensureDir(): void {
  if (!fs.existsSync(CONV_DIR)) fs.mkdirSync(CONV_DIR, { recursive: true });
}

/** Generate a short unique ID */
function generateId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${now}-${rand}`;
}

/** Derive a title from the first user message */
function deriveTitle(message: string): string {
  const clean = message.replace(/\n/g, " ").trim();
  return clean.length > 60 ? clean.substring(0, 57) + "..." : clean;
}

// ── Public API ──────────────────────────────────────────────

/** Create a new conversation and return it */
export function createConversation(provider: string, model: string): Conversation {
  ensureDir();
  return {
    id: generateId(),
    title: "New conversation",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    provider,
    model,
    messages: [],
  };
}

/** Add a message to the conversation and save */
export function addMessage(
  conv: Conversation,
  role: "user" | "assistant" | "tool",
  content: string,
  toolName?: string
): void {
  conv.messages.push({ role, content, timestamp: Date.now(), toolName });
  conv.updatedAt = Date.now();

  // Set title from first user message
  if (role === "user" && conv.title === "New conversation") {
    conv.title = deriveTitle(content);
  }

  saveConversation(conv);
}

/** Save conversation to disk */
export function saveConversation(conv: Conversation): void {
  ensureDir();
  const filePath = path.join(CONV_DIR, `${conv.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(conv, null, 2), "utf-8");
}

/** Load a conversation by ID */
export function loadConversation(id: string): Conversation | null {
  const filePath = path.join(CONV_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/** List all saved conversations, newest first */
export function listConversations(): Conversation[] {
  ensureDir();
  const files = fs.readdirSync(CONV_DIR).filter((f) => f.endsWith(".json"));
  const convs: Conversation[] = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(CONV_DIR, file), "utf-8"));
      convs.push(data);
    } catch {}
  }

  return convs.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Load the most recent conversation (for --continue flag) */
export function loadLastConversation(): Conversation | null {
  const all = listConversations();
  return all.length > 0 ? all[0] : null;
}

/** Delete a conversation by ID */
export function deleteConversation(id: string): boolean {
  const filePath = path.join(CONV_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Fork a conversation — create an identical copy with a new ID.
 * Returns the forked conversation (already saved to disk).
 */
export function forkConversation(idOrConv: string | Conversation): Conversation | null {
  const original =
    typeof idOrConv === "string" ? loadConversation(idOrConv) : idOrConv;
  if (!original) return null;

  ensureDir();
  const forked: Conversation = {
    ...original,
    id: generateId(),
    title: `Fork of: ${original.title}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: original.messages.map((m) => ({ ...m })),
  };
  saveConversation(forked);
  return forked;
}

/**
 * Update the title of a conversation in-place.
 * Useful for AI-generated titles after the first response.
 */
export function updateConversationTitle(id: string, title: string): void {
  const conv = loadConversation(id);
  if (!conv) return;
  conv.title = title.length > 80 ? title.substring(0, 77) + "..." : title;
  conv.updatedAt = Date.now();
  saveConversation(conv);
}

/** Print conversation list to console */
export function printConversationList(): void {
  const convs = listConversations();

  if (convs.length === 0) {
    console.log(chalk.dim("\n  No saved conversations.\n"));
    return;
  }

  console.log();
  console.log(chalk.bold("  Conversations:"));
  console.log();

  const limit = Math.min(convs.length, 20);
  for (let i = 0; i < limit; i++) {
    const c = convs[i];
    const date = new Date(c.updatedAt).toLocaleDateString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const msgCount = c.messages.filter((m) => m.role === "user").length;
    console.log(
      chalk.cyan(`    ${c.id}`) +
      chalk.dim(`  ${date}  (${msgCount} msgs)`) +
      `  ${c.title}`
    );
  }

  if (convs.length > 20) {
    console.log(chalk.dim(`\n    ... and ${convs.length - 20} more`));
  }

  console.log();
  console.log(chalk.dim("  Use /resume <id> to continue a conversation."));
  console.log(chalk.dim("  Use /delete <id> to remove one.\n"));
}
