/**
 * Session management routes.
 */
import { Router, type Request, type Response } from "express";
import type { SessionManager } from "../../session/session-manager";

export interface SessionRouteOptions {
  sessionManager: SessionManager;
}

export function sessionRoutes(opts: SessionRouteOptions): Router {
  const router = Router();

  // List all sessions
  router.get("/api/sessions", (_req: Request, res: Response) => {
    const sessions = opts.sessionManager.getAll().map((s) => ({
      id: s.id,
      channel: s.channel,
      chatId: s.chatId,
      userId: s.userId,
      workingDir: s.workingDir,
      historyLength: s.history.length,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
    }));
    res.json({ sessions, stats: opts.sessionManager.getStats() });
  });

  // Destroy all sessions
  router.delete("/api/sessions", (_req: Request, res: Response) => {
    opts.sessionManager.destroyAll();
    res.json({ message: "All sessions destroyed" });
  });

  // Destroy one session
  router.delete("/api/sessions/:id", (req: Request, res: Response) => {
    const parts = (req.params.id as string).split(":");
    if (parts.length !== 3) {
      res.status(400).json({ error: "Invalid session ID (expected channel:chatId:userId)" });
      return;
    }
    const destroyed = opts.sessionManager.destroy(parts[0], parts[1], parts[2]);
    res.json({ destroyed });
  });

  // Session message history
  router.get("/api/sessions/:id/history", (req: Request, res: Response) => {
    const parts = (req.params.id as string).split(":");
    if (parts.length !== 3) {
      res.status(400).json({ error: "Invalid session ID (expected channel:chatId:userId)" });
      return;
    }
    const session = opts.sessionManager.get(parts[0], parts[1], parts[2]);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ sessionId: session.id, history: session.history });
  });

  return router;
}
