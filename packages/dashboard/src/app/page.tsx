"use client";

import { useEffect, useState } from "react";
import {
  Clock,
  Users,
  Cpu,
  HardDrive,
  Radio,
  MemoryStick,
} from "lucide-react";
import { fetchStats, type StatsData } from "@/lib/api";
import { formatUptime, formatBytes } from "@/lib/utils";
import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/page-header";

export default function OverviewPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await fetchStats();
        if (mounted) { setStats(data); setError(null); }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load");
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (error) {
    return (
      <div>
        <PageHeader title="Overview" description="System overview and real-time stats" />
        <div className="card text-center py-12">
          <p className="text-red-400 text-lg font-medium">Cannot connect to gateway</p>
          <p className="text-gray-500 text-sm mt-2">{error}</p>
          <p className="text-gray-600 text-xs mt-4">Make sure the remote coding agent is running on port 4567</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div>
        <PageHeader title="Overview" description="System overview and real-time stats" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 bg-gray-800 rounded w-20 mb-3" />
              <div className="h-8 bg-gray-800 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Overview" description="System overview and real-time stats" />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Uptime"
          value={formatUptime(stats.uptime)}
          icon={<Clock className="w-5 h-5" />}
          color="blue"
        />
        <StatCard
          title="Active Sessions"
          value={stats.sessions.active}
          subtitle={`${stats.sessions.total} total`}
          icon={<Users className="w-5 h-5" />}
          color="green"
        />
        <StatCard
          title="Active Agents"
          value={stats.activeAgents}
          icon={<Cpu className="w-5 h-5" />}
          color="purple"
        />
        <StatCard
          title="Channels"
          value={`${stats.channels.running.length}/${stats.channels.available.length}`}
          subtitle="running/available"
          icon={<Radio className="w-5 h-5" />}
          color="amber"
        />
      </div>

      {/* Memory & Channels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Memory */}
        <div className="card">
          <h3 className="card-header flex items-center gap-2">
            <MemoryStick className="w-4 h-4" /> Memory Usage
          </h3>
          <div className="space-y-4 mt-4">
            {[
              { label: "RSS", value: stats.memory.rss },
              { label: "Heap Total", value: stats.memory.heapTotal },
              { label: "Heap Used", value: stats.memory.heapUsed },
              { label: "External", value: stats.memory.external },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-white font-medium">{formatBytes(value)}</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${Math.min((value / stats.memory.rss) * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Channel Status */}
        <div className="card">
          <h3 className="card-header flex items-center gap-2">
            <Radio className="w-4 h-4" /> Channel Status
          </h3>
          <div className="space-y-3 mt-4">
            {stats.channels.available.length === 0 ? (
              <p className="text-gray-500 text-sm">No channels registered</p>
            ) : (
              stats.channels.available.map((ch) => {
                const running = stats.channels.running.includes(ch);
                return (
                  <div key={ch} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className={`w-2.5 h-2.5 rounded-full ${running ? "bg-emerald-400" : "bg-gray-600"}`} />
                      <span className="text-sm text-white capitalize">{ch}</span>
                    </div>
                    <span className={running ? "badge-green" : "badge-red"}>
                      {running ? "Connected" : "Disconnected"}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Sessions by Channel */}
          {Object.keys(stats.sessions.byChannel).length > 0 && (
            <div className="mt-6">
              <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Sessions by Channel</h4>
              <div className="space-y-2">
                {Object.entries(stats.sessions.byChannel).map(([ch, count]) => (
                  <div key={ch} className="flex items-center justify-between">
                    <span className="text-sm text-gray-400 capitalize">{ch}</span>
                    <span className="text-sm text-white font-medium">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
