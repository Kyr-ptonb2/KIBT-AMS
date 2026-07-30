import { useState, useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import {
  Key, MapPin, Database, HardDrive, RotateCcw,
  Save, Eye, EyeOff, CheckCircle, ExternalLink, Sun, Moon, ShieldCheck,
  Download, RefreshCw, PartyPopper, Type
} from "lucide-react";
import { useStore } from "../store";
import { Palette } from "lucide-react";
import { getConfig, saveConfig, backupDatabase, restoreDatabase } from "../hooks/useTauri";
import { AppConfig, KIBT_REGIONS } from "../types";
import PageHeader from "../components/PageHeader";

export default function Settings() {
  const { setConfig, addToast, theme, setTheme, fontScale, setFontScale } = useStore();
  const [config, setLocalConfig] = useState<AppConfig | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Software update state ──────────────────────────────────────────────
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "upToDate" | "available" | "downloading" | "readyToRestart" | "error"
  >("idle");
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>("…");

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  const handleCheckForUpdate = async () => {
    setUpdateState("checking");
    setUpdateError(null);
    try {
      const update = await checkForUpdate();
      if (update?.available) {
        setPendingUpdate(update);
        setUpdateState("available");
      } else {
        setUpdateState("upToDate");
      }
    } catch (e: any) {
      setUpdateError(String(e));
      setUpdateState("error");
    }
  };

  const handleInstallUpdate = async () => {
    if (!pendingUpdate) return;
    setUpdateState("downloading");
    setDownloadProgress(0);
    try {
      let downloaded = 0;
      let total = 0;
      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (total > 0) setDownloadProgress(Math.round((downloaded / total) * 100));
            break;
          case "Finished":
            setDownloadProgress(100);
            break;
        }
      });
      setUpdateState("readyToRestart");
    } catch (e: any) {
      setUpdateError(String(e));
      setUpdateState("error");
    }
  };

  const handleRestartNow = async () => {
    await relaunch();
  };


  useEffect(() => {
    getConfig().then((c) => { setLocalConfig(c); setConfig(c); });
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await saveConfig(config);
      setConfig(config);
      addToast({ type: "success", message: "Settings saved." });
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleBackup = async () => {
    try {
      const path = await save({
        defaultPath: `kibt-ams-backup-${new Date().toISOString().slice(0, 10)}.db`,
        filters: [{ name: "Database", extensions: ["db"] }],
      });
      if (!path) return;
      await backupDatabase(path);
      addToast({ type: "success", message: "Database backed up successfully." });
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    }
  };

  const handleRestore = async () => {
    if (!confirm("Restore database from backup? This will REPLACE your current data. The app will need to restart.")) return;
    try {
      const path = await open({ filters: [{ name: "Database", extensions: ["db"] }] });
      if (!path) return;
      await restoreDatabase(path as string);
      addToast({ type: "success", message: "Database restored. Please restart the app." });
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    }
  };

  if (!config) return <div className="flex items-center justify-center h-screen text-gray-400 text-sm">Loading settings…</div>;

  return (
    <div className="min-h-full page-bg">
      <PageHeader
        title="Settings"
        subtitle="Application configuration and database management"
        actions={
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? "Saving…" : "Save Settings"}
          </button>
        }
      />

      <div className="px-8 py-6 max-w-2xl space-y-5">
        {/* ── Appearance ──────────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Palette size={16} className="text-kibt-green" />
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-heading)" }}>Appearance</h3>
          </div>
          <div>
            <label className="label">Theme</label>
            <div className="flex gap-3 mt-1">
              <button
                onClick={() => setTheme("light")}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all text-sm font-medium ${
                  theme === "light"
                    ? "border-kibt-green bg-kibt-green/5 text-kibt-green"
                    : "border-transparent hover:border-gray-200"
                }`}
                style={{ backgroundColor: theme === "light" ? undefined : "var(--bg-muted)", color: theme === "light" ? undefined : "var(--text-secondary)" }}
              >
                <Sun size={16} />
                Light
                {theme === "light" && <CheckCircle size={13} className="ml-auto" />}
              </button>
              <button
                onClick={() => setTheme("dark")}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all text-sm font-medium ${
                  theme === "dark"
                    ? "border-kibt-green bg-kibt-green/5 text-kibt-green"
                    : "border-transparent hover:border-gray-200"
                }`}
                style={{ backgroundColor: theme === "dark" ? undefined : "var(--bg-muted)", color: theme === "dark" ? undefined : "var(--text-secondary)" }}
              >
                <Moon size={16} />
                Dark
                {theme === "dark" && <CheckCircle size={13} className="ml-auto" />}
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
              Theme is saved automatically and persists across sessions.
            </p>
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <Type size={13} /> Text Size
            </label>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {([
                { value: "sm", label: "Small",  sample: "text-xs"  },
                { value: "md", label: "Default", sample: "text-sm" },
                { value: "lg", label: "Large",  sample: "text-base" },
                { value: "xl", label: "X-Large", sample: "text-lg" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFontScale(opt.value)}
                  className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl border-2 transition-all font-medium ${
                    fontScale === opt.value
                      ? "border-kibt-green bg-kibt-green/5 text-kibt-green"
                      : "border-transparent hover:border-gray-200"
                  }`}
                  style={{ backgroundColor: fontScale === opt.value ? undefined : "var(--bg-muted)", color: fontScale === opt.value ? undefined : "var(--text-secondary)" }}
                >
                  <span className={opt.sample}>Aa</span>
                  <span className="text-xs">{opt.label}</span>
                  {fontScale === opt.value && <CheckCircle size={12} />}
                </button>
              ))}
            </div>
            <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
              Scales text and UI size across the whole app. Saved automatically.
            </p>
          </div>
        </div>

        {/* ── Gemini API key ────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-kibt-green" />
            <h3 className="text-sm font-semibold text-gray-800">Gemini API Key</h3>
            {config.geminiApiKey && (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium ml-auto">
                <CheckCircle size={12} /> Key configured
              </span>
            )}
          </div>
          <div className="relative">
            <input
              className="input pr-10"
              type={showKey ? "text" : "password"}
              placeholder="Paste your free Gemini API key here"
              value={config.geminiApiKey ?? ""}
              onChange={(e) => setLocalConfig({ ...config, geminiApiKey: e.target.value })}
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <div className="text-xs text-gray-500 bg-blue-50 rounded-lg px-4 py-3 space-y-1">
            <p className="font-medium text-blue-700">How to get a free API key:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
              <li>Open <strong>aistudio.google.com</strong> in a browser</li>
              <li>Sign in with any Google account (Gmail works)</li>
              <li>Click "Get API Key" → "Create API key"</li>
              <li>Copy and paste the key above</li>
            </ol>
            <p className="text-blue-500 mt-1">Free tier: 1,500 requests/day · No credit card needed · Key stored securely in OS keychain</p>
          </div>
          <a
            href="https://aistudio.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-kibt-green hover:underline"
          >
            <ExternalLink size={12} /> Open Google AI Studio
          </a>
        </div>

        {/* ── Groq API key (backup provider) ─────────────────────────── */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-800">Backup AI Provider (Groq)</h3>
            {config.groqApiKey && (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium ml-auto">
                <CheckCircle size={12} /> Key configured
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Optional. If Gemini is unavailable during a scan (rate limit, outage, or invalid key),
            KIBT-AMS automatically switches to Groq's free Llama Vision model so scanning never stops
            completely. Strongly recommended for field use.
          </p>
          <div className="relative">
            <input
              className="input pr-10"
              type={showGroqKey ? "text" : "password"}
              placeholder="Paste your free Groq API key here (optional)"
              value={config.groqApiKey ?? ""}
              onChange={(e) => setLocalConfig({ ...config, groqApiKey: e.target.value })}
            />
            <button
              onClick={() => setShowGroqKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showGroqKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <div className="text-xs text-gray-500 bg-amber-50 rounded-lg px-4 py-3 space-y-1">
            <p className="font-medium text-amber-700">How to get a free Groq API key:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-amber-700">
              <li>Open <strong>console.groq.com</strong> in a browser</li>
              <li>Sign in with any Google or GitHub account</li>
              <li>Click "API Keys" → "Create API Key"</li>
              <li>Copy and paste the key above</li>
            </ol>
            <p className="text-amber-600 mt-1">
              Completely free · No credit card required · Fast inference · Key stored securely in OS keychain
            </p>
          </div>
          <a
            href="https://console.groq.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-kibt-green hover:underline"
          >
            <ExternalLink size={12} /> Open Groq Console
          </a>
        </div>

        {/* ── Preferences ──────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-kibt-green" />
            <h3 className="text-sm font-semibold text-gray-800">Preferences</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Default Region</label>
              <select
                className="select"
                value={config.defaultRegion ?? ""}
                onChange={(e) => setLocalConfig({ ...config, defaultRegion: e.target.value })}
              >
                <option value="">— None —</option>
                {KIBT_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="auto-update"
              type="checkbox"
              className="w-4 h-4 rounded accent-kibt-green"
              checked={config.autoUpdate}
              onChange={(e) => setLocalConfig({ ...config, autoUpdate: e.target.checked })}
            />
            <label htmlFor="auto-update" className="text-sm text-gray-700 cursor-pointer select-text">
              Check for updates automatically on startup
            </label>
          </div>
        </div>

        {/* ── Software Updates ──────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="text-kibt-green" />
              <h3 className="text-sm font-semibold text-gray-800">Software Updates</h3>
            </div>
            <span className="text-xs text-gray-400">Version {currentVersion}</span>
          </div>

          {updateState === "idle" && (
            <button className="btn-secondary w-full justify-center" onClick={handleCheckForUpdate}>
              <RefreshCw size={14} /> Check for Updates
            </button>
          )}

          {updateState === "checking" && (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-2">
              <RefreshCw size={14} className="animate-spin" /> Checking for updates…
            </div>
          )}

          {updateState === "upToDate" && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2.5">
              <CheckCircle size={14} /> You're on the latest version.
            </div>
          )}

          {updateState === "available" && pendingUpdate && (
            <div className="space-y-3">
              <div className="text-sm text-gray-700 bg-blue-50 rounded-lg px-3 py-2.5">
                <p className="font-medium">Version {pendingUpdate.version} is available</p>
                {pendingUpdate.body && (
                  <p className="text-xs text-gray-500 mt-1 whitespace-pre-line">{pendingUpdate.body}</p>
                )}
              </div>
              <button className="btn-primary w-full justify-center" onClick={handleInstallUpdate}>
                <Download size={14} /> Download &amp; Install
              </button>
            </div>
          )}

          {updateState === "downloading" && (
            <div className="space-y-2">
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="bg-kibt-green h-full transition-all" style={{ width: `${downloadProgress}%` }} />
              </div>
              <p className="text-xs text-gray-500 text-center">Downloading update… {downloadProgress}%</p>
            </div>
          )}

          {updateState === "readyToRestart" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2.5">
                <PartyPopper size={14} /> Update installed — restart to finish.
              </div>
              <button className="btn-primary w-full justify-center" onClick={handleRestartNow}>
                <RefreshCw size={14} /> Restart Now
              </button>
            </div>
          )}

          {updateState === "error" && (
            <div className="space-y-2">
              <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2.5 break-all">
                Update check failed: {updateError}
              </div>
              <button className="btn-secondary w-full justify-center" onClick={handleCheckForUpdate}>
                <RefreshCw size={14} /> Try Again
              </button>
            </div>
          )}
        </div>

        {/* ── Database ──────────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-kibt-green" />
            <h3 className="text-sm font-semibold text-gray-800">Database</h3>
          </div>

          {config.databasePath && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 font-mono break-all">
              {config.databasePath}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button className="btn-secondary w-full justify-center" onClick={handleBackup}>
              <HardDrive size={14} /> Backup Database
            </button>
            <button className="btn-secondary w-full justify-center text-amber-700 border-amber-200 hover:bg-amber-50" onClick={handleRestore}>
              <RotateCcw size={14} /> Restore from Backup
            </button>
          </div>

          <div className="text-xs text-gray-400">
            The database is a single <code className="bg-gray-100 px-1 rounded">.db</code> file you can copy to back up, and replace to restore. No special tools required.
          </div>
        </div>
      </div>
    </div>
  );
}
