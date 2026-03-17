/**
 * Formatting helpers for the remote agent TUI dashboard
 */

/**
 * Format an uptime duration in seconds to a human-readable string.
 * Examples: "42s", "3m", "2h15m", "1d4h"
 */
export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return s > 0 ? `${m}m${s}s` : `${m}m`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${d}d${h}h` : `${d}d`;
}

/**
 * Format a Date as a relative "time since" string.
 * Examples: "3s ago", "5m ago", "2h ago", "1d ago"
 */
export function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Shorten a model name for display by stripping common prefixes and truncating.
 * Examples: "claude-3-5-sonnet-20241022" -> "3-5-sonnet-20241022"
 *           "gpt-4o-mini" -> "4o-mini"
 *           "some-very-long-model-name-here" -> "some-very-long-model-na..."
 */
export function shortModel(model: string, maxLength = 24): string {
  let short = model;
  // Strip common provider prefixes
  for (const prefix of ["claude-", "gpt-", "gemini-", "o1-", "models/"]) {
    if (short.startsWith(prefix)) {
      short = short.slice(prefix.length);
      break;
    }
  }
  if (short.length > maxLength) {
    return short.slice(0, maxLength - 3) + "...";
  }
  return short;
}

/**
 * Format an engine event for display in the event log.
 */
export function formatEventDetail(event: {
  timestamp: Date;
  type: string;
  message?: string;
}): { time: string; type: string; detail: string; color: string } {
  const time = event.timestamp.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  let color = "white";
  switch (event.type) {
    case "error":
      color = "red";
      break;
    case "warning":
      color = "yellow";
      break;
    case "success":
    case "connected":
    case "started":
      color = "green";
      break;
    case "message":
    case "task":
      color = "cyan";
      break;
    case "info":
    default:
      color = "white";
      break;
  }

  return {
    time,
    type: event.type,
    detail: event.message || "",
    color,
  };
}
