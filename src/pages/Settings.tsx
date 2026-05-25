import { useState, useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Key, MapPin, Database, HardDrive, RotateCcw,
  Save, Eye, EyeOff, CheckCircle, ExternalLink
} from "lucide-react";
import { useStore } from "../store";
import { getConfig, saveConfig, backupDatabase, restoreDatabase } from "../hooks/useTauri";
import { AppConfig, KIBT_REGIONS } from "../types";
import PageHeader from "../components/PageHeader";

export default function Settings() {
  const { setConfig, addToast } = useStore();
  const [config, setLocalConfig] = useState<AppConfig | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

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
    <div className="min-h-full bg-gray-50">
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
            <div>
              <label className="label">Scan Method Preference</label>
              <select
                className="select"
                value={config.scanMethodPreference}
                onChange={(e) => setLocalConfig({ ...config, scanMethodPreference: e.target.value as any })}
              >
                <option value="auto">Auto (recommended)</option>
                <option value="online">Always Online (Gemini)</option>
                <option value="offline">Always Offline (Tesseract)</option>
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
