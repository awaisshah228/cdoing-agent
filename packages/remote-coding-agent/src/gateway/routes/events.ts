/**
 * SSE event stream route for real-time dashboard updates.
 */
import { Router, type Request, type Response } from "express";

export interface EventRouteOptions {
  addClient: (res: Response) => void;
  removeClient: (res: Response) => void;
}

export function eventRoutes(opts: EventRouteOptions): Router {
  const router = Router();

  router.get("/api/events", (req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("data: {\"type\":\"connected\"}\n\n");
    opts.addClient(res);
    req.on("close", () => opts.removeClient(res));
  });

  return router;
}
