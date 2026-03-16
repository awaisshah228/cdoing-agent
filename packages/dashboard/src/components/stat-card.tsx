import { type ReactNode } from "react";
import { clsx } from "clsx";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  color?: "blue" | "green" | "amber" | "red" | "purple";
}

const colorMap = {
  blue: "bg-blue-500/10 text-blue-400",
  green: "bg-emerald-500/10 text-emerald-400",
  amber: "bg-amber-500/10 text-amber-400",
  red: "bg-red-500/10 text-red-400",
  purple: "bg-purple-500/10 text-purple-400",
};

export function StatCard({ title, value, subtitle, icon, color = "blue" }: StatCardProps) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="card-header">{title}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        {icon && (
          <div className={clsx("w-10 h-10 rounded-lg flex items-center justify-center", colorMap[color])}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
