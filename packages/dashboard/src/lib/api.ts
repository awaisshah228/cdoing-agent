/**
 * API client for the Remote Coding Agent gateway.
 *
 * When served from the gateway (same origin), uses relative URLs.
 * In dev mode, falls back to NEXT_PUBLIC_GATEWAY_URL env variable.
 */

function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    // In browser: if served from gateway, use same origin (relative)
    const env = process.env.NEXT_PUBLIC_GATEWAY_URL;
    if (env) return env;
    // Same-origin: dashboard is served at /dashboard/ on the gateway
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:4567";
}

const AUTH_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN || "";

function headers(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  if (AUTH_TOKEN) h["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  return h;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: headers(),
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Health ──

export interface HealthData {
  status: string;
  uptime: number;
  sessions: number;
  activeAgents: number;
  channels: string[];
  timestamp: string;
}

export function fetchHealth(): Promise<HealthData> {
  return request("/health");
}

// ── Stats ──

export interface StatsData {
  sessions: { total: number; active: number; expired: number; byChannel: Record<string, number> };
  activeAgents: number;
  channels: { available: string[]; running: string[] };
  uptime: number;
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number };
}

export function fetchStats(): Promise<StatsData> {
  return request("/api/stats");
}

// ── Sessions ──

export interface SessionItem {
  id: string;
  channel: string;
  chatId: string;
  userId: string;
  workingDir: string;
  historyLength: number;
  createdAt: string;
  lastActiveAt: string;
}

export interface SessionsResponse {
  sessions: SessionItem[];
  stats: StatsData["sessions"];
}

export function fetchSessions(): Promise<SessionsResponse> {
  return request("/api/sessions");
}

export function destroySession(id: string): Promise<{ destroyed: boolean }> {
  return request(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function destroyAllSessions(): Promise<{ message: string }> {
  return request("/api/sessions", { method: "DELETE" });
}

export interface SessionHistory {
  sessionId: string;
  history: Array<{ role: string; content: string; timestamp: number; toolCallId?: string }>;
}

export function fetchSessionHistory(id: string): Promise<SessionHistory> {
  return request(`/api/sessions/${encodeURIComponent(id)}/history`);
}

// ── Channels ──

export interface ChannelItem {
  id: string;
  name: string;
  description: string;
  running: boolean;
  configSchema?: Record<string, unknown>;
}

export function fetchChannels(): Promise<{ channels: ChannelItem[] }> {
  return request("/api/channels");
}

// ── Config ──

export interface AppConfig {
  agent: {
    provider: string;
    model: string;
    apiKey?: string;
    maxTurns: number;
    permissionMode: string;
    systemPrompt?: string;
    maxTokens?: number;
  };
  gateway: { port: number; authToken?: string; corsOrigin: string };
  session: { ttlMs: number; maxHistoryMessages: number; maxSessions: number };
  security: { channelRules: Record<string, unknown>; rateLimitPerMinute: number; allowedDirs: string[] };
  channels: Record<string, Record<string, unknown>>;
  workingDir: string;
  logLevel: string;
}

export function fetchConfig(): Promise<AppConfig> {
  return request("/api/config");
}

export function updateConfig(patch: Partial<AppConfig>): Promise<{ success: boolean; message: string }> {
  return request("/api/config", { method: "PUT", body: JSON.stringify(patch) });
}

// ── Send Message ──

export function sendMessage(channel: string, chatId: string, text: string): Promise<{ success: boolean }> {
  return request("/api/send", { method: "POST", body: JSON.stringify({ channel, chatId, text }) });
}

// ── SSE Events ──

export function connectEvents(onEvent: (event: Record<string, unknown>) => void): () => void {
  const url = `${getBaseUrl()}/api/events`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch { /* ignore parse errors */ }
  };

  eventSource.onerror = () => {
    // Auto-reconnects
  };

  return () => eventSource.close();
}
