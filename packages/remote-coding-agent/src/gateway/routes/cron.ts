/**
 * Cron job management routes.
 */
import { Router, type Request, type Response } from "express";
import type { CronService } from "../../cron/service";

export interface CronRouteOptions {
  getCronService: () => CronService | undefined;
}

export function cronRoutes(opts: CronRouteOptions): Router {
  const router = Router();

  function getCron(res: Response): CronService | null {
    const svc = opts.getCronService();
    if (!svc) {
      res.status(503).json({ error: "Cron service not available" });
      return null;
    }
    return svc;
  }

  // Status
  router.get("/api/cron/status", (_req: Request, res: Response) => {
    const svc = getCron(res);
    if (!svc) return;
    res.json(svc.status());
  });

  // List all jobs
  router.get("/api/cron/jobs", (_req: Request, res: Response) => {
    const svc = getCron(res);
    if (!svc) return;
    res.json({ jobs: svc.list() });
  });

  // Get single job
  router.get("/api/cron/jobs/:id", (req: Request, res: Response) => {
    const svc = getCron(res);
    if (!svc) return;
    const job = svc.get(req.params.id as string);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    res.json(job);
  });

  // Add a job
  router.post("/api/cron/jobs", (req: Request, res: Response) => {
    const svc = getCron(res);
    if (!svc) return;
    try {
      const job = svc.add(req.body);
      res.status(201).json(job);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Update a job
  router.patch("/api/cron/jobs/:id", (req: Request, res: Response) => {
    const svc = getCron(res);
    if (!svc) return;
    const job = svc.update(req.params.id as string, req.body);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    res.json(job);
  });

  // Remove a job
  router.delete("/api/cron/jobs/:id", (req: Request, res: Response) => {
    const svc = getCron(res);
    if (!svc) return;
    const removed = svc.remove(req.params.id as string);
    res.json({ removed });
  });

  // Trigger a job immediately
  router.post("/api/cron/jobs/:id/run", async (req: Request, res: Response) => {
    const svc = getCron(res);
    if (!svc) return;
    const entry = await svc.triggerNow(req.params.id as string);
    if (!entry) { res.status(404).json({ error: "Job not found" }); return; }
    res.json(entry);
  });

  // Get run history
  router.get("/api/cron/runs", (req: Request, res: Response) => {
    const svc = getCron(res);
    if (!svc) return;
    const jobId = req.query.jobId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    res.json({ runs: svc.getRuns(jobId, limit) });
  });

  return router;
}
