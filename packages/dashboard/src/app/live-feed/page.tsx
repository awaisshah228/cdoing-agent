"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Pause,
  Play,
  Trash2,
  Filter,
} from "lucide-react";
import { connectEvents } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

interface FeedEvent {
  id: number;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const EVENT_COLORS: Record<string, string> = {
  "engine:start": "text-blue-400",
  "engine:stop": "text-red-400",
  "channel:connected": "text-emerald-400",
  "channel:disconnected": "text-red-400",
  "channel:error": "text-red-400",
  "message:received": "text-cyan-400",
  "agent:start": "text-purple-400",
  "agent:token": "text-gray-600",
  "agent:tool_call": "text-amber-400",
  "agent:complete": "text-emerald-400",
  "agent:error": "text-red-400",
  "session:created": "text-blue-400",
  "session:expired": "text-gray-500",
  connected: "text-gray-600",
};

const MAX_EVENTS = 200;

export default function LiveFeedPage() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const disconnect = connectEvents((raw) => {
      if (pausedRef.current) return;

      const type = (raw.type as string) || "unknown";
      if (type === "connected") {
        setConnected(true);
        return;
      }

      const event: FeedEvent = {
        id: ++idRef.current,
        type,
        timestamp: new Date().toISOString(),
        data: raw,
      };

      setEvents((prev) => {
        const next = [...prev, event];
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      });
    });

    return () => {
      disconnect();
      setConnected(false);
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, paused]);

  const filtered = filter
    ? events.filter((e) => e.type.includes(filter))
    : events.filter((e) => e.type !== "agent:token"); // Hide noisy token events by default

  return (
    <div>
      <PageHeader
        title="Live Feed"
        description="Real-time event stream from the agent engine"
        actions={
          <div className="flex items-center gap-3">
            <span className={`flex items-center gap-1.5 text-xs ${connected ? "text-emerald-400" : "text-gray-500"}`}>
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
              {connected ? "Streaming" : "Disconnected"}
            </span>
            <div className="relative">
              <Filter className="w-3 h-3 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Filter events..."
                className="input-field pl-8 w-48"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <button
              onClick={() => setPaused(!paused)}
              className={`btn-secondary flex items-center gap-2 ${paused ? "!bg-amber-600/20 !text-amber-400" : ""}`}
            >
              {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() => setEvents([])}
              className="btn-secondary flex items-center gap-2"
            >
              <Trash2 className="w-3 h-3" /> Clear
            </button>
          </div>
        }
      />

      <div className="card p-0">
        <div
          ref={scrollRef}
          className="h-[calc(100vh-240px)] overflow-y-auto font-mono text-xs"
        >
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <Activity className="w-8 h-8 mb-3" />
              <p>{connected ? "Waiting for events..." : "Connecting to event stream..."}</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-gray-900 z-10">
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-2 text-gray-500 font-medium w-24">Time</th>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium w-40">Event</th>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                    </td>
                    <td className={`px-4 py-2 whitespace-nowrap font-medium ${EVENT_COLORS[e.type] || "text-gray-400"}`}>
                      {e.type}
                    </td>
                    <td className="px-4 py-2 text-gray-400 truncate max-w-xl">
                      {formatEventDetails(e.data)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t border-gray-800 px-4 py-2 flex items-center justify-between text-xs text-gray-600">
          <span>{filtered.length} events{filter ? " (filtered)" : ""}</span>
          <span>{events.length}/{MAX_EVENTS} total</span>
        </div>
      </div>
    </div>
  );
}

function formatEventDetails(data: Record<string, unknown>): string {
  const { type, ...rest } = data;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v === "object" && v !== null) {
      parts.push(`${k}=${JSON.stringify(v).substring(0, 100)}`);
    } else {
      parts.push(`${k}=${v}`);
    }
  }
  return parts.join("  ");
}
