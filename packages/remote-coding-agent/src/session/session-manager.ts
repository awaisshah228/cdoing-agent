/**
 * Session Manager
 *
 * Channel-agnostic session management with:
 *   - In-memory store with TTL expiration
 *   - Per-user conversation history for agent continuity
 *   - Session isolation (each channel:chat:user gets own context)
 *   - Auto-cleanup of stale sessions
 *
 * Sessions are keyed by channel:chatId:userId, so a user talking
 * via Telegram and Discord gets separate sessions.
 */

import type { Session, SerializedMessage, SessionConfig } from "../types";
import { Logger } from "../utils/logger";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SESSIONS_DIR = path.join(os.homedir(), ".cdoing", "remote", "sessions");

const DEFAULTS: SessionConfig = {
  ttlMs: 30 * 60 * 1000,
  maxHistoryMessages: 50,
  maxSessions: 100,
};

export class SessionManager {
  private sessions = new Map<string, Session>();
  private config: SessionConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private logger: Logger;

  constructor(config: Partial<SessionConfig> = {}, logLevel: string = "info") {
    this.config = { ...DEFAULTS, ...config };
    this.logger = new Logger("SessionManager", logLevel);
  }

  // ── Session Lifecycle ──────────────────────────────────────────────────

  getOrCreate(channel: string, chatId: string, userId: string, workingDir: string): Session {
    const key = this.key(channel, chatId, userId);
    let session = this.sessions.get(key);

    if (session) {
      session.lastActiveAt = new Date();
      return session;
    }

    if (this.sessions.size >= this.config.maxSessions) {
      this.evictOldest();
    }

    session = {
      id: key,
      channel,
      chatId,
      userId,
      workingDir,
      history: [],
      createdAt: new Date(),
      lastActiveAt: new Date(),
      metadata: {},
    };

    this.sessions.set(key, session);
    this.logger.debug(`Session created: ${key}`);
    return session;
  }

  get(channel: string, chatId: string, userId: string): Session | null {
    const key = this.key(channel, chatId, userId);
    const session = this.sessions.get(key);
    if (!session) return null;

    if (Date.now() - session.lastActiveAt.getTime() > this.config.ttlMs) {
      this.sessions.delete(key);
      return null;
    }

    return session;
  }

  /** Get a session by its full ID (channel:chatId:userId). */
  getById(sessionId: string): Session | null {
    return this.sessions.get(sessionId) || null;
  }

  destroy(channel: string, chatId: string, userId: string): boolean {
    return this.sessions.delete(this.key(channel, chatId, userId));
  }

  destroyAll(): void {
    this.sessions.clear();
  }

  // ── History ────────────────────────────────────────────────────────────

  addMessage(session: Session, role: SerializedMessage["role"], content: string, toolCallId?: string): void {
    session.history.push({ role, content, toolCallId, timestamp: Date.now() });

    if (session.history.length > this.config.maxHistoryMessages) {
      session.history.splice(0, session.history.length - this.config.maxHistoryMessages);
    }

    session.lastActiveAt = new Date();
  }

  getFormattedHistory(session: Session): string {
    if (session.history.length === 0) return "";

    const lines = session.history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-10)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.substring(0, 500)}`);

    return [
      "Conversation history (recent messages for context):",
      ...lines,
      "---",
      "Use this context to maintain continuity.",
    ].join("\n");
  }

  clearHistory(session: Session): void {
    session.history = [];
  }

  // ── Queries ────────────────────────────────────────────────────────────

  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  getByChannel(channel: string): Session[] {
    return this.getAll().filter((s) => s.channel === channel);
  }

  get size(): number {
    return this.sessions.size;
  }

  getStats(): { total: number; active: number; expired: number; byChannel: Record<string, number> } {
    let active = 0;
    let expired = 0;
    const byChannel: Record<string, number> = {};
    const now = Date.now();

    for (const session of this.sessions.values()) {
      if (now - session.lastActiveAt.getTime() > this.config.ttlMs) {
        expired++;
      } else {
        active++;
      }
      byChannel[session.channel] = (byChannel[session.channel] || 0) + 1;
    }

    return { total: this.sessions.size, active, expired, byChannel };
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  startCleanup(intervalMs: number = 60_000): void {
    this.stopCleanup();
    this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt.getTime() > this.config.ttlMs) {
        this.sessions.delete(key);
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, s] of this.sessions.entries()) {
      if (s.lastActiveAt.getTime() < oldestTime) {
        oldestTime = s.lastActiveAt.getTime();
        oldestKey = key;
      }
    }
    if (oldestKey) this.sessions.delete(oldestKey);
  }

  private key(channel: string, chatId: string, userId: string): string {
    return `${channel}:${chatId}:${userId}`;
  }

  // ── Disk Persistence ──────────────────────────────────────────────────
  // Save sessions to ~/.cdoing/remote/sessions/ on shutdown,
  // load them back on startup for continuity across restarts.

  /** Save all sessions to disk. Call this on graceful shutdown. */
  saveToDisk(): void {
    try {
      if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

      const sessions = this.getAll().map((s) => ({
        id: s.id,
        channel: s.channel,
        chatId: s.chatId,
        userId: s.userId,
        workingDir: s.workingDir,
        history: s.history.slice(-this.config.maxHistoryMessages),
        createdAt: s.createdAt.toISOString(),
        lastActiveAt: s.lastActiveAt.toISOString(),
        metadata: s.metadata,
      }));

      const filePath = path.join(SESSIONS_DIR, "sessions.json");
      fs.writeFileSync(filePath, JSON.stringify(sessions, null, 2), { mode: 0o600 });
      this.logger.info(`Saved ${sessions.length} sessions to disk`);
    } catch (err) {
      this.logger.error(`Failed to save sessions: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Load sessions from disk. Call this on startup before accepting messages. */
  loadFromDisk(): number {
    try {
      const filePath = path.join(SESSIONS_DIR, "sessions.json");
      if (!fs.existsSync(filePath)) return 0;

      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as Array<{
        id: string;
        channel: string;
        chatId: string;
        userId: string;
        workingDir: string;
        history: SerializedMessage[];
        createdAt: string;
        lastActiveAt: string;
        metadata: Record<string, unknown>;
      }>;

      let loaded = 0;
      for (const entry of data) {
        // Skip expired sessions
        const lastActive = new Date(entry.lastActiveAt);
        if (Date.now() - lastActive.getTime() > this.config.ttlMs) continue;

        const session: Session = {
          id: entry.id,
          channel: entry.channel,
          chatId: entry.chatId,
          userId: entry.userId,
          workingDir: entry.workingDir,
          history: entry.history,
          createdAt: new Date(entry.createdAt),
          lastActiveAt: lastActive,
          metadata: entry.metadata || {},
        };
        this.sessions.set(session.id, session);
        loaded++;
      }

      if (loaded > 0) this.logger.info(`Loaded ${loaded} sessions from disk`);
      return loaded;
    } catch (err) {
      this.logger.error(`Failed to load sessions: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
  }
}
