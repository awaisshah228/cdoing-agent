/**
 * Conversation History Manager for TUI
 *
 * Saves conversations to ~/.cdoing/conversations/ as JSON files.
 * Mirrors the base CLI implementation for full compatibility.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONV_DIR = path.join(os.homedir(), ".cdoing", "conversations");

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model: string;
  messages: ChatMessage[];
}

function ensureDir(): void {
  if (!fs.existsSync(CONV_DIR)) fs.mkdirSync(CONV_DIR, { recursive: true });
}

function generateId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${now}-${rand}`;
}

function deriveTitle(message: string): string {
  const clean = message.replace(/\n/g, " ").trim();
  return clean.length > 60 ? clean.substring(0, 57) + "..." : clean;
}

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

export function addMessage(
  conv: Conversation,
  role: "user" | "assistant" | "tool",
  content: string,
  toolName?: string
): void {
  conv.messages.push({ role, content, timestamp: Date.now(), toolName });
  conv.updatedAt = Date.now();

  if (role === "user" && conv.title === "New conversation") {
    conv.title = deriveTitle(content);
  }

  saveConversation(conv);
}

export function saveConversation(conv: Conversation): void {
  ensureDir();
  const filePath = path.join(CONV_DIR, `${conv.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(conv, null, 2), "utf-8");
}

export function loadConversation(id: string): Conversation | null {
  // Support partial IDs
  ensureDir();
  const files = fs.readdirSync(CONV_DIR).filter((f) => f.endsWith(".json"));
  const match = files.find((f) => f.startsWith(id) || f.replace(".json", "") === id);
  if (!match) return null;

  const filePath = path.join(CONV_DIR, match);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

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

export function loadLastConversation(): Conversation | null {
  const all = listConversations();
  return all.length > 0 ? all[0] : null;
}

export function deleteConversation(id: string): boolean {
  ensureDir();
  const files = fs.readdirSync(CONV_DIR).filter((f) => f.endsWith(".json"));
  const match = files.find((f) => f.startsWith(id) || f.replace(".json", "") === id);
  if (match) {
    fs.unlinkSync(path.join(CONV_DIR, match));
    return true;
  }
  return false;
}

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

export function updateConversationTitle(id: string, title: string): void {
  const conv = loadConversation(id);
  if (!conv) return;
  conv.title = title.length > 80 ? title.substring(0, 77) + "..." : title;
  conv.updatedAt = Date.now();
  saveConversation(conv);
}

export function formatRelativeDate(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
