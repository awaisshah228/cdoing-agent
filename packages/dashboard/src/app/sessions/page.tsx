"use client";

import { useEffect, useState } from "react";
import {
  MessagesSquare,
  Trash2,
  ChevronDown,
  ChevronUp,
  Clock,
  User,
  FolderOpen,
} from "lucide-react";
import {
  fetchSessions,
  destroySession,
  destroyAllSessions,
  fetchSessionHistory,
  type SessionItem,
  type SessionHistory,
} from "@/lib/api";
import { timeAgo, formatTimestamp } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<SessionHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async () => {
    try {
      const data = await fetchSessions();
      setSessions(data.sessions);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleDestroy = async (id: string) => {
    if (!confirm(`Destroy session ${id}?`)) return;
    await destroySession(id);
    load();
  };

  const handleDestroyAll = async () => {
    if (!confirm("Destroy ALL sessions? This cannot be undone.")) return;
    await destroyAllSessions();
    load();
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setHistory(null);
      return;
    }
    setExpandedId(id);
    setHistoryLoading(true);
    try {
      const h = await fetchSessionHistory(id);
      setHistory(h);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  };

  return (
    <div>
      <PageHeader
        title="Sessions"
        description="Manage active conversation sessions"
        actions={
          sessions.length > 0 ? (
            <button onClick={handleDestroyAll} className="btn-danger flex items-center gap-2">
              <Trash2 className="w-4 h-4" /> Destroy All
            </button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 bg-gray-800 rounded w-48 mb-2" />
              <div className="h-3 bg-gray-800 rounded w-32" />
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="card text-center py-12">
          <MessagesSquare className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400">No active sessions</p>
          <p className="text-gray-600 text-sm mt-1">Sessions appear when users send messages via channels</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div key={s.id} className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => toggleExpand(s.id)}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    {expandedId === s.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="badge-blue capitalize">{s.channel}</span>
                      <span className="text-white font-medium text-sm">{s.id}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" /> {s.userId}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessagesSquare className="w-3 h-3" /> {s.historyLength} messages
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {timeAgo(s.lastActiveAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <FolderOpen className="w-3 h-3" /> {s.workingDir}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDestroy(s.id)}
                  className="text-gray-500 hover:text-red-400 transition-colors p-2"
                  title="Destroy session"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Expanded: Message History */}
              {expandedId === s.id && (
                <div className="mt-4 border-t border-gray-800 pt-4">
                  <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Message History</h4>
                  {historyLoading ? (
                    <div className="animate-pulse space-y-2">
                      {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-gray-800 rounded" />)}
                    </div>
                  ) : !history || history.history.length === 0 ? (
                    <p className="text-gray-600 text-sm">No messages yet</p>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {history.history.map((msg, i) => (
                        <div
                          key={i}
                          className={`rounded-lg p-3 text-sm ${
                            msg.role === "user"
                              ? "bg-blue-500/5 border border-blue-500/10"
                              : msg.role === "assistant"
                              ? "bg-gray-800"
                              : "bg-amber-500/5 border border-amber-500/10"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-medium ${
                              msg.role === "user" ? "text-blue-400" :
                              msg.role === "assistant" ? "text-gray-400" :
                              "text-amber-400"
                            }`}>
                              {msg.role}
                            </span>
                            <span className="text-xs text-gray-600">{formatTimestamp(msg.timestamp)}</span>
                          </div>
                          <p className="text-gray-300 whitespace-pre-wrap break-words">{msg.content.substring(0, 500)}</p>
                          {msg.content.length > 500 && (
                            <p className="text-gray-600 text-xs mt-1">... ({msg.content.length} chars total)</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
