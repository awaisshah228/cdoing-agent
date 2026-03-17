"use client";

import { useEffect, useState } from "react";
import {
  Clock,
  Plus,
  Trash2,
  Play,
  Pause,
  RotateCw,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: { kind: string; everyMs?: number; expr?: string; at?: string };
  payload: { kind: string; message?: string; text?: string };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: string;
    lastError?: string;
    runCount?: number;
    lastDurationMs?: number;
  };
}

interface CronRun {
  jobId: string;
  jobName: string;
  startedAt: number;
  completedAt: number;
  status: string;
  error?: string;
  durationMs: number;
}

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_GATEWAY_URL || window.location.origin;
  }
  return process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:4567";
}

function getAuthToken(): string {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) return urlToken;
  }
  return process.env.NEXT_PUBLIC_GATEWAY_TOKEN || "";
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const h: HeadersInit = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) (h as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: h,
    ...opts,
  });
  return res.json();
}

function formatSchedule(s: CronJob["schedule"]): string {
  if (s.kind === "every") return `Every ${Math.round((s.everyMs || 0) / 1000)}s`;
  if (s.kind === "cron") return `Cron: ${s.expr}`;
  if (s.kind === "at") return `At: ${s.at}`;
  return s.kind;
}

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newJob, setNewJob] = useState({ name: "", everyMs: "60000", message: "" });

  const load = async () => {
    try {
      const [j, r] = await Promise.all([
        api<{ jobs: CronJob[] }>("/api/cron/jobs"),
        api<{ runs: CronRun[] }>("/api/cron/runs?limit=20"),
      ]);
      setJobs(j.jobs);
      setRuns(r.runs);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, []);

  const addJob = async () => {
    if (!newJob.name || !newJob.message) return;
    await api("/api/cron/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: newJob.name,
        enabled: true,
        schedule: { kind: "every", everyMs: parseInt(newJob.everyMs) || 60000 },
        payload: { kind: "agentTurn", message: newJob.message },
      }),
    });
    setShowAdd(false);
    setNewJob({ name: "", everyMs: "60000", message: "" });
    load();
  };

  const toggleJob = async (id: string, enabled: boolean) => {
    await api(`/api/cron/jobs/${id}`, { method: "PATCH", body: JSON.stringify({ enabled: !enabled }) });
    load();
  };

  const deleteJob = async (id: string) => {
    if (!confirm("Delete this cron job?")) return;
    await api(`/api/cron/jobs/${id}`, { method: "DELETE" });
    load();
  };

  const triggerJob = async (id: string) => {
    await api(`/api/cron/jobs/${id}/run`, { method: "POST" });
    load();
  };

  return (
    <div>
      <PageHeader
        title="Cron Jobs"
        description="Scheduled and recurring tasks"
        actions={
          <button onClick={() => setShowAdd(!showAdd)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Job
          </button>
        }
      />

      {/* Add Job Form */}
      {showAdd && (
        <div className="card mb-6">
          <h3 className="text-sm font-medium text-white mb-4">New Cron Job</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input className="input-field" placeholder="e.g. daily-review" value={newJob.name}
                onChange={(e) => setNewJob({ ...newJob, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Interval (ms)</label>
              <input className="input-field" type="number" placeholder="60000" value={newJob.everyMs}
                onChange={(e) => setNewJob({ ...newJob, everyMs: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Agent Message</label>
              <input className="input-field" placeholder="e.g. Check for issues" value={newJob.message}
                onChange={(e) => setNewJob({ ...newJob, message: e.target.value })} />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={addJob} className="btn-primary">Create</button>
            <button onClick={() => setShowAdd(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Jobs List */}
      {loading ? (
        <div className="card animate-pulse"><div className="h-20 bg-gray-800 rounded" /></div>
      ) : jobs.length === 0 ? (
        <div className="card text-center py-12">
          <Clock className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400">No cron jobs configured</p>
          <p className="text-gray-600 text-sm mt-1">Add a job to run agent tasks on a schedule</p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {jobs.map((job) => (
            <div key={job.id} className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className={`w-2.5 h-2.5 rounded-full ${job.enabled ? "bg-emerald-400" : "bg-gray-600"}`} />
                  <div>
                    <h4 className="text-white font-medium text-sm">{job.name}</h4>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>{formatSchedule(job.schedule)}</span>
                      <span>{job.payload.kind === "agentTurn" ? `"${job.payload.message}"` : job.payload.text}</span>
                      {job.state.runCount != null && <span>{job.state.runCount} runs</span>}
                      {job.state.lastRunStatus && (
                        <span className={`flex items-center gap-1 ${job.state.lastRunStatus === "ok" ? "text-emerald-400" : "text-red-400"}`}>
                          {job.state.lastRunStatus === "ok" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {job.state.lastRunStatus}
                        </span>
                      )}
                      {job.state.nextRunAtMs && (
                        <span>Next: {new Date(job.state.nextRunAtMs).toLocaleTimeString()}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => triggerJob(job.id)} className="p-1.5 text-gray-500 hover:text-blue-400" title="Run now">
                    <Play className="w-4 h-4" />
                  </button>
                  <button onClick={() => toggleJob(job.id, job.enabled)} className="p-1.5 text-gray-500 hover:text-amber-400"
                    title={job.enabled ? "Disable" : "Enable"}>
                    {job.enabled ? <Pause className="w-4 h-4" /> : <RotateCw className="w-4 h-4" />}
                  </button>
                  <button onClick={() => deleteJob(job.id)} className="p-1.5 text-gray-500 hover:text-red-400" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Run History */}
      {runs.length > 0 && (
        <div className="card">
          <h3 className="card-header">Recent Runs</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-xs">
                  <th className="text-left py-2 pr-4">Job</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-left py-2 pr-4">Duration</th>
                  <th className="text-left py-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice().reverse().map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <td className="py-2 pr-4 text-gray-300">{r.jobName}</td>
                    <td className="py-2 pr-4">
                      <span className={r.status === "ok" ? "badge-green" : "badge-red"}>{r.status}</span>
                    </td>
                    <td className="py-2 pr-4 text-gray-500">{r.durationMs}ms</td>
                    <td className="py-2 text-gray-500">{new Date(r.startedAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
