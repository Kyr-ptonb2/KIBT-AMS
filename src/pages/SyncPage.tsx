// SyncPage.tsx — Offline database sync via .kibt file (USB transfer)
//
// EXPORT tab: Choose date range → save .kibt file → copy to USB
// IMPORT tab: Open .kibt file from USB → preview contents → merge into DB

import { useState } from "react";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Upload, HardDrive, CheckCircle,
  AlertCircle, Loader, FileDown, FileUp,
  Info, RefreshCw, Users, Calendar
} from "lucide-react";
import { useStore } from "../store";
import { exportSyncPackage, peekSyncPackage, importSyncPackage } from "../hooks/useTauri";
import { ExportSyncResult, ImportSyncResult, SyncPackageInfo } from "../types";
import PageHeader from "../components/PageHeader";
import { useQueryClient } from "@tanstack/react-query";

type Tab = "export" | "import";

export default function SyncPage() {
  const [tab, setTab] = useState<Tab>("export");

  return (
    <div className="min-h-full page-bg">
      <PageHeader
        title="Offline Sync"
        subtitle="Transfer data between computers using a USB drive or any file"
      />

      <div className="px-8 py-6 max-w-3xl space-y-5">

        {/* How it works banner */}
        <div className="card p-4 flex gap-4 items-start">
          <HardDrive size={20} className="text-kibt-green flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold" style={{ color: "var(--text-heading)" }}>
              How offline sync works
            </p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              <strong>PC1 (Export):</strong> Choose a date range → saves a <code className="text-xs bg-gray-100 px-1 rounded">.kibt</code> file → copy to USB drive.
            </p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              <strong>PC2 (Import):</strong> Open the <code className="text-xs bg-gray-100 px-1 rounded">.kibt</code> file from USB → preview what's inside → merge into local database.
            </p>
            <p className="text-xs text-kibt-green font-medium mt-1">
              ✓ No data on PC2 is ever deleted or overwritten — only new records are added.
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={() => setTab("export")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              tab === "export" ? "bg-kibt-green text-white" : ""
            }`}
            style={tab !== "export" ? { backgroundColor: "var(--bg-card)", color: "var(--text-secondary)" } : {}}
          >
            <FileDown size={15} /> Export from this PC
          </button>
          <button
            onClick={() => setTab("import")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              tab === "import" ? "bg-kibt-green text-white" : ""
            }`}
            style={tab !== "import" ? { backgroundColor: "var(--bg-card)", color: "var(--text-secondary)" } : {}}
          >
            <FileUp size={15} /> Import onto this PC
          </button>
        </div>

        {tab === "export" && <ExportPanel />}
        {tab === "import" && <ImportPanel />}
      </div>
    </div>
  );
}

// ── Export Panel ──────────────────────────────────────────────────────────────

function ExportPanel() {
  const { addToast } = useStore();
  const [label, setLabel]         = useState("");
  const [mode, setMode]           = useState<"all" | "since">("since");
  const [sinceDate, setSinceDate] = useState(() => {
    // Default to start of current month
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-01`;
  });
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState<ExportSyncResult | null>(null);

  const handleExport = async () => {
    if (!label.trim()) { addToast({ type: "error", message: "Enter a label for this PC (e.g. Nakuru Office PC)" }); return; }

    const path = await save({
      defaultPath: `KIBT-Sync-${label.trim().replace(/\s+/g,"-")}-${new Date().toISOString().slice(0,10)}.kibt`,
      filters: [{ name: "KIBT Sync File", extensions: ["kibt"] }],
    });
    if (!path) return;

    setLoading(true);
    setResult(null);
    try {
      const r = await exportSyncPackage(
        path,
        mode === "since" ? sinceDate : null,
        label.trim()
      );
      setResult(r);
      addToast({ type: "success", message: `Sync file saved — ${r.participants} participants exported` });
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-heading)" }}>
          Export Settings
        </h3>

        {/* PC label */}
        <div>
          <label className="label">Label for this PC *</label>
          <input
            className="input"
            placeholder="e.g. Nakuru Office PC, Kisumu Laptop, HQ Desktop"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            This label appears on PC2 so the recipient knows where the data came from.
          </p>
        </div>

        {/* Date range */}
        <div>
          <label className="label">What to export</label>
          <div className="space-y-2">
            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border transition-colors"
              style={{ borderColor: mode === "since" ? "var(--kibt-green, #1a6b3c)" : "var(--border)", backgroundColor: mode === "since" ? "rgba(26,107,60,0.05)" : "var(--bg-muted)" }}>
              <input type="radio" checked={mode === "since"} onChange={() => setMode("since")} className="mt-0.5" />
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Records since a date</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Only export new data — faster, smaller file</p>
                {mode === "since" && (
                  <input type="date" className="input mt-2 w-44 text-xs"
                    value={sinceDate} onChange={e => setSinceDate(e.target.value)} />
                )}
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border transition-colors"
              style={{ borderColor: mode === "all" ? "var(--kibt-green, #1a6b3c)" : "var(--border)", backgroundColor: mode === "all" ? "rgba(26,107,60,0.05)" : "var(--bg-muted)" }}>
              <input type="radio" checked={mode === "all"} onChange={() => setMode("all")} className="mt-0.5" />
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Full database export</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Export everything — use for first-time setup or full backup</p>
              </div>
            </label>
          </div>
        </div>

        <button
          className="btn-primary w-full justify-center"
          onClick={handleExport}
          disabled={loading}
        >
          {loading
            ? <><Loader size={14} className="animate-spin" /> Exporting…</>
            : <><FileDown size={14} /> Save .kibt File</>
          }
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-green-500" />
            <span className="text-sm font-semibold text-green-700">Export complete</span>
            <span className="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>{result.fileSizeKb} KB</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Events",       result.events],
              ["Sessions",     result.eventSessions],
              ["Participants", result.participants],
              ["Scans",        result.scans],
              ["Tables",       result.customTableDefs],
              ["Table Rows",   result.customTableRows],
            ].map(([label, count]) => (
              <div key={label as string} className="rounded-lg p-3 text-center"
                style={{ backgroundColor: "var(--bg-muted)" }}>
                <p className="text-lg font-bold text-kibt-green">{count}</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Saved to: <code className="text-xs">{result.path}</code>
          </p>
          <div className="flex items-start gap-2 text-xs p-3 rounded-lg"
            style={{ backgroundColor: "var(--bg-muted)", color: "var(--text-secondary)" }}>
            <Info size={12} className="mt-0.5 flex-shrink-0" />
            Copy <strong>{result.path.split(/[\\\/]/).pop()}</strong> to a USB drive, email, or any storage. Then open it on PC2 using the Import tab.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Import Panel ──────────────────────────────────────────────────────────────

function ImportPanel() {
  const { addToast } = useStore();
  const qc = useQueryClient();
  const [info, setInfo]         = useState<SyncPackageInfo | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult]     = useState<ImportSyncResult | null>(null);

  const handleBrowse = async () => {
    const path = await openDialog({
      filters: [{ name: "KIBT Sync File", extensions: ["kibt"] }],
      multiple: false,
    });
    if (!path || typeof path !== "string") return;

    setLoading(true);
    setInfo(null);
    setResult(null);
    setFilePath(path);
    try {
      const i = await peekSyncPackage(path);
      setInfo(i);
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
      setFilePath(null);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!filePath) return;
    setImporting(true);
    try {
      const r = await importSyncPackage(filePath);
      setResult(r);
      // Invalidate all queries so UI refreshes with merged data
      qc.invalidateQueries();
      if (r.errors.length === 0) {
        addToast({ type: "success", message: `Sync complete — ${r.participantsInserted} participants merged` });
      } else {
        addToast({ type: "warning", message: `Synced with ${r.errors.length} error(s) — check details below` });
      }
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally {
      setImporting(false);
    }
  };

  const reset = () => { setInfo(null); setFilePath(null); setResult(null); };

  return (
    <div className="space-y-4">
      {/* Step 1 — Browse */}
      {!info && !result && (
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-heading)" }}>
            Step 1 — Select the .kibt file
          </h3>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Insert the USB drive, then click Browse to find the .kibt file exported from the other PC.
          </p>
          <button className="btn-primary w-full justify-center" onClick={handleBrowse} disabled={loading}>
            {loading
              ? <><Loader size={14} className="animate-spin" /> Reading file…</>
              : <><Upload size={14} /> Browse for .kibt File</>
            }
          </button>
        </div>
      )}

      {/* Step 2 — Preview */}
      {info && !result && (
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-heading)" }}>
                Step 2 — Review before importing
              </h3>
              <button className="text-xs underline" style={{ color: "var(--text-muted)" }} onClick={reset}>
                Choose different file
              </button>
            </div>

            {/* File info */}
            <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: "var(--bg-muted)" }}>
              <div className="flex items-center gap-2 mb-1">
                <HardDrive size={14} className="text-kibt-green" />
                <span className="text-sm font-semibold" style={{ color: "var(--text-heading)" }}>
                  {info.sourceLabel || "Unknown source"}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-kibt-green/10 text-kibt-green font-medium ml-auto">
                  v{info.version}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                <span>Exported by: <strong style={{ color: "var(--text-primary)" }}>{info.exportedBy}</strong></span>
                <span>File size: <strong style={{ color: "var(--text-primary)" }}>{info.fileSizeKb} KB</strong></span>
                <span>Exported at: <strong style={{ color: "var(--text-primary)" }}>{info.exportedAt.slice(0,16).replace("T"," ")}</strong></span>
                <span>Since: <strong style={{ color: "var(--text-primary)" }}>{info.since ? info.since.slice(0,10) : "Full export"}</strong></span>
              </div>
            </div>

            {/* Record counts */}
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>Records in this file:</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  [Calendar,  "Events",           info.eventCount],
                  [Users,     "Participants",      info.participantCount],
                  [HardDrive, "Custom Tables",     info.customTableCount],
                  [HardDrive, "Custom Table Rows", info.customRowCount],
                ].map(([, label, count]) => (
                  <div key={label as string} className="flex items-center gap-3 rounded-lg p-3"
                    style={{ backgroundColor: "var(--bg-muted)", border: "1px solid var(--border-light)" }}>
                    <span className="text-2xl font-bold text-kibt-green">{count as number}</span>
                    <div>
                      <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{label as string}</p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>to merge</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Safety note */}
            <div className="flex items-start gap-2 rounded-lg p-3"
              style={{ backgroundColor: "rgba(26,107,60,0.06)", border: "1px solid rgba(26,107,60,0.15)" }}>
              <CheckCircle size={13} className="text-kibt-green mt-0.5 flex-shrink-0" />
              <p className="text-xs text-kibt-green">
                <strong>Safe to import.</strong> Records already on this PC are never overwritten. Only new records (by UUID) will be added.
              </p>
            </div>

            <button
              className="btn-primary w-full justify-center"
              onClick={handleImport}
              disabled={importing}
            >
              {importing
                ? <><Loader size={14} className="animate-spin" /> Merging data…</>
                : <><RefreshCw size={14} /> Import &amp; Merge</>
              }
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Result */}
      {result && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            {result.errors.length === 0
              ? <CheckCircle size={16} className="text-green-500" />
              : <AlertCircle size={16} className="text-amber-500" />
            }
            <span className="text-sm font-semibold" style={{ color: "var(--text-heading)" }}>
              Sync complete — from "{result.sourceLabel}"
            </span>
          </div>

          {/* Inserted counts */}
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Events added",         result.eventsInserted],
              ["Sessions added",       result.eventSessionsInserted],
              ["Participants added",   result.participantsInserted],
              ["Scans added",          result.scansInserted],
              ["Tables added",         result.customTableDefsInserted],
              ["Table rows added",     result.customTableRowsInserted],
            ].map(([label, count]) => (
              <div key={label as string} className="rounded-lg p-3 text-center"
                style={{ backgroundColor: "var(--bg-muted)" }}>
                <p className={`text-xl font-bold ${(count as number) > 0 ? "text-kibt-green" : ""}`}
                  style={(count as number) === 0 ? { color: "var(--text-muted)" } : {}}>
                  {count as number}
                </p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label as string}</p>
              </div>
            ))}
          </div>

          {/* Skipped */}
          {(result.eventsSkipped > 0 || result.participantsSkipped > 0) && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Skipped (already existed): {result.eventsSkipped} events, {result.participantsSkipped} participants
            </p>
          )}

          {/* Errors */}
          {result.errors.length > 0 && (
            <div className="rounded-lg p-3 space-y-1" style={{ backgroundColor: "rgba(220,38,38,0.05)", border: "1px solid rgba(220,38,38,0.15)" }}>
              <p className="text-xs font-semibold text-red-600">{result.errors.length} error(s):</p>
              {result.errors.slice(0,5).map((e, i) => (
                <p key={i} className="text-xs text-red-600 font-mono">{e}</p>
              ))}
              {result.errors.length > 5 && (
                <p className="text-xs text-red-400">…and {result.errors.length - 5} more</p>
              )}
            </div>
          )}

          <button className="btn-secondary w-full justify-center text-sm" onClick={reset}>
            Import Another File
          </button>
        </div>
      )}
    </div>
  );
}
