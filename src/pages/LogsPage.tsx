import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity, LogIn, LogOut, UserPlus, Trash2, ScanLine,
  Download, Settings, Shield, User, RefreshCw, FileText,
} from "lucide-react";
import PageHeader from "../components/PageHeader";

interface AuditLog {
  id: string; actorId?: string; actorName?: string; action: string;
  category: string; targetId?: string; targetName?: string;
  detail?: string; occurredAt: string;
}

// ── Action icon + colour map ──────────────────────────────────────────────────
const ACTION_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  "auth.login":          { icon: <LogIn size={13} />,     color: "text-green-600 bg-green-50",   label: "Login"            },
  "auth.login_failed":   { icon: <LogIn size={13} />,     color: "text-red-600 bg-red-50",       label: "Failed Login"     },
  "auth.logout":         { icon: <LogOut size={13} />,    color: "text-gray-600 bg-gray-100",    label: "Logout"           },
  "auth.profile_setup":  { icon: <Shield size={13} />,    color: "text-blue-600 bg-blue-50",     label: "Profile Setup"    },
  "user.create":         { icon: <UserPlus size={13} />,  color: "text-blue-600 bg-blue-50",     label: "User Created"     },
  "user.delete":         { icon: <Trash2 size={13} />,    color: "text-red-600 bg-red-50",       label: "User Deleted"     },
  "user.role_change":    { icon: <Shield size={13} />,    color: "text-purple-600 bg-purple-50", label: "Role Changed"     },
  "user.password_reset": { icon: <User size={13} />,      color: "text-amber-600 bg-amber-50",   label: "Password Reset"   },
  "event.create":        { icon: <Activity size={13} />,  color: "text-green-600 bg-green-50",   label: "Event Created"    },
  "event.delete":        { icon: <Trash2 size={13} />,    color: "text-red-600 bg-red-50",       label: "Event Deleted"    },
  "participant.save_batch": { icon: <UserPlus size={13} />, color: "text-green-600 bg-green-50", label: "Participants Saved"},
  "participant.update":  { icon: <User size={13} />,      color: "text-blue-600 bg-blue-50",     label: "Participant Edited"},
  "participant.delete":  { icon: <Trash2 size={13} />,    color: "text-red-600 bg-red-50",       label: "Participant Deleted"},
  "scan.gemini":         { icon: <ScanLine size={13} />,  color: "text-green-600 bg-green-50",   label: "Scan (Gemini)"    },
  "export.excel":        { icon: <Download size={13} />,  color: "text-blue-600 bg-blue-50",     label: "Excel Export"     },
  "export.csv":          { icon: <Download size={13} />,  color: "text-blue-600 bg-blue-50",     label: "CSV Export"       },
  "config.save":         { icon: <Settings size={13} />,  color: "text-gray-600 bg-gray-100",    label: "Settings Saved"   },
  "config.backup":       { icon: <FileText size={13} />,  color: "text-purple-600 bg-purple-50", label: "DB Backup"        },
  "config.restore":      { icon: <FileText size={13} />,  color: "text-amber-600 bg-amber-50",   label: "DB Restored"      },
};

const CATEGORIES = ["auth", "event", "participant", "scan", "user", "export", "config"];

const CAT_COLORS: Record<string, string> = {
  auth:        "bg-blue-100 text-blue-700",
  event:       "bg-green-100 text-green-700",
  participant: "bg-teal-100 text-teal-700",
  scan:        "bg-amber-100 text-amber-700",
  user:        "bg-purple-100 text-purple-700",
  export:      "bg-indigo-100 text-indigo-700",
  config:      "bg-gray-100 text-gray-600",
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export default function LogsPage() {
  const [category, setCategory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(200);

  const { data: logs, isLoading, refetch } = useQuery<AuditLog[]>({
    queryKey: ["logs", category, fromDate, toDate, limit],
    queryFn: () => invoke("get_logs", {
      filter: {
        category: category || null,
        fromDate: fromDate || null,
        toDate: toDate || null,
        limit,
      },
    }),
    refetchInterval: 15_000, // auto-refresh every 15 seconds
  });

  const { data: summary } = useQuery<[string, number][]>({
    queryKey: ["log_summary"],
    queryFn: () => invoke("get_log_summary"),
    refetchInterval: 30_000,
  });

  // Client-side text search
  const filtered = logs?.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.action.includes(q) ||
      (l.actorName ?? "").toLowerCase().includes(q) ||
      (l.targetName ?? "").toLowerCase().includes(q) ||
      (l.detail ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title="Audit Logs"
        subtitle="Complete history of all system actions"
        actions={
          <button className="btn-secondary" onClick={() => refetch()}>
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      <div className="px-8 py-6 space-y-5">
        {/* Summary cards */}
        {summary && summary.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {summary.slice(0, 4).map(([cat, count]) => (
              <button
                key={cat}
                onClick={() => setCategory(cat === category ? "" : cat)}
                className={`card p-4 text-left transition-shadow hover:shadow-md ${cat === category ? "ring-2 ring-kibt-green" : ""}`}
              >
                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium mb-2 ${CAT_COLORS[cat] ?? "bg-gray-100 text-gray-600"}`}>
                  {cat}
                </div>
                <div className="text-2xl font-bold text-gray-800">{count}</div>
                <div className="text-xs text-gray-400">last 30 days</div>
              </button>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="card p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-48">
              <label className="label">Search</label>
              <input
                className="input text-sm"
                placeholder="Search action, user, target…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="select text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">From</label>
              <input type="date" className="input text-sm" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" className="input text-sm" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Show</label>
              <select className="select text-sm" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={2000}>2000</option>
              </select>
            </div>
            {(category || fromDate || toDate || search) && (
              <button
                className="btn-secondary text-xs"
                onClick={() => { setCategory(""); setFromDate(""); setToDate(""); setSearch(""); }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Log table */}
        <div className="card overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 text-xs text-gray-500 flex items-center justify-between">
            <span>{filtered?.length ?? 0} entries</span>
            <span className="text-gray-400">Auto-refreshes every 15s</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading logs…</div>
          ) : !filtered || filtered.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No log entries found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr className="text-left text-xs text-gray-500">
                    <th className="px-4 py-2.5 font-medium">Time</th>
                    <th className="px-3 py-2.5 font-medium">Action</th>
                    <th className="px-3 py-2.5 font-medium">Category</th>
                    <th className="px-3 py-2.5 font-medium">User</th>
                    <th className="px-3 py-2.5 font-medium">Target</th>
                    <th className="px-3 py-2.5 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((log) => {
                    const meta = ACTION_META[log.action];
                    return (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap font-mono">
                          {formatTime(log.occurredAt)}
                        </td>
                        <td className="px-3 py-2.5">
                          {meta ? (
                            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${meta.color}`}>
                              {meta.icon} {meta.label}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-600 font-mono">{log.action}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CAT_COLORS[log.category] ?? "bg-gray-100 text-gray-600"}`}>
                            {log.category}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-700">
                          {log.actorName ?? <span className="text-gray-300">system</span>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-600 max-w-48 truncate" title={log.targetName}>
                          {log.targetName ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500 max-w-56 truncate" title={log.detail}>
                          {log.detail ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
