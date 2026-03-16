/**
 * Cron/Scheduler type definitions.
 *
 * Inspired by OpenClaw's cron system. Supports:
 *   - One-shot scheduled tasks ("at")
 *   - Recurring interval tasks ("every")
 *   - Standard cron expressions ("cron")
 */

/** Schedule type — when the job should run. */
export type CronSchedule =
  | { kind: "at"; at: string }                            // ISO-8601 one-shot
  | { kind: "every"; everyMs: number; anchorMs?: number } // Recurring interval
  | { kind: "cron"; expr: string; tz?: string };          // Cron expression

/** What the job does when it fires. */
export type CronPayload =
  | { kind: "systemEvent"; text: string }                 // Internal event
  | { kind: "agentTurn"; message: string; model?: string; channel?: string; to?: string };

/** Where to deliver results. */
export type CronDeliveryMode = "none" | "announce" | "webhook";

export interface CronDelivery {
  mode: CronDeliveryMode;
  channel?: string;
  to?: string;
  webhookUrl?: string;
}

/** Run status tracking. */
export type CronRunStatus = "ok" | "error" | "skipped";

export interface CronJobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: CronRunStatus;
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  runCount?: number;
}

/** Full cron job definition. */
export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  delivery?: CronDelivery;
  createdAt: number;
  updatedAt: number;
  state: CronJobState;
}

/** For creating a new job (id and state are auto-generated). */
export type CronJobCreate = Omit<CronJob, "id" | "createdAt" | "updatedAt" | "state"> & {
  state?: Partial<CronJobState>;
};

/** For updating an existing job. */
export type CronJobPatch = Partial<Omit<CronJob, "id" | "createdAt">>;

/** Run log entry for history. */
export interface CronRunEntry {
  jobId: string;
  jobName: string;
  startedAt: number;
  completedAt: number;
  status: CronRunStatus;
  error?: string;
  durationMs: number;
}
