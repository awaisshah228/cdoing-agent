/**
 * Cron Service — Manages scheduled jobs.
 *
 * Provides:
 *   - Job CRUD (add, update, remove, list)
 *   - Tick-based scheduler (checks every 10s)
 *   - Run history log
 *   - Status reporting for dashboard/API
 */

import { Logger } from "../utils/logger";
import type {
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronJobState,
  CronRunEntry,
  CronSchedule,
} from "./types";

const TICK_INTERVAL_MS = 10_000; // Check every 10 seconds
const MAX_RUN_LOG = 200;

let nextId = 1;

function generateId(): string {
  return `cron_${Date.now()}_${nextId++}`;
}

export class CronService {
  private jobs = new Map<string, CronJob>();
  private runLog: CronRunEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private logger: Logger;
  private onJobFire?: (job: CronJob) => Promise<void>;

  constructor(logLevel: string = "info", onJobFire?: (job: CronJob) => Promise<void>) {
    this.logger = new Logger("CronService", logLevel);
    this.onJobFire = onJobFire;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.logger.info("Cron scheduler started");

    // Compute initial next-run times
    for (const job of this.jobs.values()) {
      if (job.enabled && !job.state.nextRunAtMs) {
        job.state.nextRunAtMs = this.computeNextRun(job.schedule);
      }
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("Cron scheduler stopped");
  }

  // ── CRUD ───────────────────────────────────────────────────────────────

  add(create: CronJobCreate): CronJob {
    const now = Date.now();
    const job: CronJob = {
      ...create,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      state: {
        ...create.state,
        nextRunAtMs: create.enabled ? this.computeNextRun(create.schedule) : undefined,
        runCount: 0,
      },
    };
    this.jobs.set(job.id, job);
    this.logger.info(`Job added: ${job.name} (${job.id})`);
    return job;
  }

  update(id: string, patch: CronJobPatch): CronJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    if (patch.name !== undefined) job.name = patch.name;
    if (patch.enabled !== undefined) job.enabled = patch.enabled;
    if (patch.schedule) job.schedule = patch.schedule;
    if (patch.payload) job.payload = patch.payload;
    if (patch.delivery) job.delivery = patch.delivery;
    job.updatedAt = Date.now();

    if (job.enabled) {
      job.state.nextRunAtMs = this.computeNextRun(job.schedule);
    } else {
      job.state.nextRunAtMs = undefined;
    }

    this.logger.info(`Job updated: ${job.name} (${job.id})`);
    return job;
  }

  remove(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.jobs.delete(id);
    this.logger.info(`Job removed: ${job.name} (${id})`);
    return true;
  }

  get(id: string): CronJob | null {
    return this.jobs.get(id) || null;
  }

  list(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  // ── Run History ────────────────────────────────────────────────────────

  getRuns(jobId?: string, limit: number = 50): CronRunEntry[] {
    const entries = jobId
      ? this.runLog.filter((r) => r.jobId === jobId)
      : this.runLog;
    return entries.slice(-limit);
  }

  // ── Status ─────────────────────────────────────────────────────────────

  status(): { running: boolean; totalJobs: number; enabledJobs: number; totalRuns: number } {
    const jobs = Array.from(this.jobs.values());
    return {
      running: this.timer !== null,
      totalJobs: jobs.length,
      enabledJobs: jobs.filter((j) => j.enabled).length,
      totalRuns: this.runLog.length,
    };
  }

  // ── Trigger (manual run) ───────────────────────────────────────────────

  async triggerNow(id: string): Promise<CronRunEntry | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    return this.executeJob(job);
  }

  // ── Scheduler Tick ─────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    const now = Date.now();

    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (!job.state.nextRunAtMs) continue;
      if (now < job.state.nextRunAtMs) continue;

      // Time to run
      try {
        await this.executeJob(job);
      } catch (err) {
        this.logger.error(`Job ${job.name} failed: ${err}`);
      }

      // One-shot "at" jobs disable after running
      if (job.schedule.kind === "at") {
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
      } else {
        job.state.nextRunAtMs = this.computeNextRun(job.schedule);
      }
    }
  }

  private async executeJob(job: CronJob): Promise<CronRunEntry> {
    const startedAt = Date.now();
    let status: CronRunEntry["status"] = "ok";
    let error: string | undefined;

    try {
      if (this.onJobFire) {
        await this.onJobFire(job);
      } else {
        this.logger.info(`Job fired: ${job.name} (${job.id}) — ${job.payload.kind}`);
      }

      job.state.lastRunStatus = "ok";
      job.state.consecutiveErrors = 0;
    } catch (err) {
      status = "error";
      error = err instanceof Error ? err.message : String(err);
      job.state.lastRunStatus = "error";
      job.state.lastError = error;
      job.state.consecutiveErrors = (job.state.consecutiveErrors || 0) + 1;
    }

    const completedAt = Date.now();
    job.state.lastRunAtMs = startedAt;
    job.state.lastDurationMs = completedAt - startedAt;
    job.state.runCount = (job.state.runCount || 0) + 1;

    const entry: CronRunEntry = {
      jobId: job.id,
      jobName: job.name,
      startedAt,
      completedAt,
      status,
      error,
      durationMs: completedAt - startedAt,
    };

    this.runLog.push(entry);
    if (this.runLog.length > MAX_RUN_LOG) {
      this.runLog.splice(0, this.runLog.length - MAX_RUN_LOG);
    }

    return entry;
  }

  // ── Schedule Computation ───────────────────────────────────────────────

  private computeNextRun(schedule: CronSchedule): number {
    const now = Date.now();

    switch (schedule.kind) {
      case "at":
        return new Date(schedule.at).getTime();

      case "every": {
        const anchor = schedule.anchorMs ?? now;
        if (anchor > now) return anchor;
        const elapsed = now - anchor;
        const periods = Math.floor(elapsed / schedule.everyMs);
        return anchor + (periods + 1) * schedule.everyMs;
      }

      case "cron":
        // Simple cron: just add 60s as a basic approximation.
        // For production, use a cron parser library like "croner".
        return now + 60_000;
    }
  }
}
