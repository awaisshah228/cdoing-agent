"use client";

import { useEffect, useState } from "react";
import { fetchHealth } from "@/lib/api";

export function ConnectionStatus() {
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        await fetchHealth();
        if (mounted) setStatus("connected");
      } catch {
        if (mounted) setStatus("error");
      }
    };
    check();
    const interval = setInterval(check, 15000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`w-2 h-2 rounded-full ${
          status === "connected" ? "bg-emerald-400" :
          status === "error" ? "bg-red-400" :
          "bg-amber-400 animate-pulse"
        }`}
      />
      <span className="text-gray-500">
        {status === "connected" ? "Gateway connected" :
         status === "error" ? "Gateway offline" :
         "Connecting..."}
      </span>
    </div>
  );
}
