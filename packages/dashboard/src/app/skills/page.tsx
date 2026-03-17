"use client";

import { useEffect, useState } from "react";
import { Sparkles, ToggleLeft, ToggleRight, ChevronDown, ChevronUp } from "lucide-react";
import { PageHeader } from "@/components/page-header";

interface SkillItem {
  id: string;
  name: string;
  description: string;
  location: string;
  enabled: boolean;
  always: boolean;
  userInvocable: boolean;
}

interface SkillDetail extends SkillItem {
  content: string;
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

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);

  const load = async () => {
    try {
      const data = await api<{ skills: SkillItem[] }>("/api/skills");
      setSkills(data.skills);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleSkill = async (id: string, currentEnabled: boolean) => {
    await api(`/api/skills/${id}/${currentEnabled ? "disable" : "enable"}`, { method: "POST" });
    load();
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    try {
      const d = await api<SkillDetail>(`/api/skills/${id}`);
      setDetail(d);
    } catch { /* ignore */ }
  };

  const alwaysSkills = skills.filter((s) => s.always);
  const invocableSkills = skills.filter((s) => s.userInvocable && !s.always);

  return (
    <div>
      <PageHeader
        title="Skills"
        description="Extensible prompt-based capabilities for the agent"
      />

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card animate-pulse"><div className="h-12 bg-gray-800 rounded" /></div>
          ))}
        </div>
      ) : skills.length === 0 ? (
        <div className="card text-center py-12">
          <Sparkles className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400">No skills loaded</p>
          <p className="text-gray-600 text-sm mt-1">
            Add skills in .cdoing/skills/ as markdown files with YAML frontmatter
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Always-on Skills */}
          {alwaysSkills.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
                Always Active ({alwaysSkills.length})
              </h3>
              <div className="space-y-2">
                {alwaysSkills.map((s) => <SkillCard key={s.id} skill={s} expandedId={expandedId}
                  detail={detail} onToggle={toggleSkill} onExpand={toggleExpand} />)}
              </div>
            </div>
          )}

          {/* User-Invocable Skills */}
          {invocableSkills.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
                User-Invocable Skills ({invocableSkills.length})
              </h3>
              <div className="space-y-2">
                {invocableSkills.map((s) => <SkillCard key={s.id} skill={s} expandedId={expandedId}
                  detail={detail} onToggle={toggleSkill} onExpand={toggleExpand} />)}
              </div>
            </div>
          )}

          {/* Info */}
          <div className="card bg-blue-500/5 border-blue-500/10">
            <h4 className="text-sm font-medium text-blue-400 mb-2">Adding Custom Skills</h4>
            <p className="text-xs text-gray-400 leading-relaxed">
              Create a <code className="text-blue-300">.md</code> file in <code className="text-blue-300">.cdoing/skills/</code> or{" "}
              <code className="text-blue-300">~/.cdoing/skills/</code> with YAML frontmatter:
            </p>
            <pre className="mt-3 text-xs text-gray-500 bg-gray-800/50 rounded-lg p-3">{`---
name: my-skill
description: What this skill does
userInvocable: true
---
Your prompt instructions here...`}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillCard({
  skill, expandedId, detail, onToggle, onExpand,
}: {
  skill: SkillItem;
  expandedId: string | null;
  detail: SkillDetail | null;
  onToggle: (id: string, enabled: boolean) => void;
  onExpand: (id: string) => void;
}) {
  const expanded = expandedId === skill.id;

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => onExpand(skill.id)} className="text-gray-500 hover:text-white">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-white font-medium text-sm">{skill.name}</span>
              {skill.always && <span className="badge-blue text-[10px]">always</span>}
              {skill.userInvocable && <span className="badge-green text-[10px]">invocable</span>}
              {skill.location === "builtin" && <span className="text-[10px] text-gray-600">built-in</span>}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{skill.description}</p>
          </div>
        </div>
        <button onClick={() => onToggle(skill.id, skill.enabled)} className="text-gray-500 hover:text-white">
          {skill.enabled
            ? <ToggleRight className="w-6 h-6 text-emerald-400" />
            : <ToggleLeft className="w-6 h-6 text-gray-600" />
          }
        </button>
      </div>

      {expanded && detail && detail.id === skill.id && (
        <div className="mt-4 border-t border-gray-800 pt-4">
          <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
            <span>Source: {detail.location}</span>
          </div>
          <pre className="text-xs text-gray-400 bg-gray-800 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
            {detail.content}
          </pre>
        </div>
      )}
    </div>
  );
}
