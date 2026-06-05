import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  User, Lock, Mail, Phone, CreditCard, Eye, EyeOff,
  Loader, ShieldCheck, Key, Copy, CheckCircle, AlertTriangle
} from "lucide-react";
import { useStore } from "../store";

export default function SetupProfilePage() {
  const { currentUser, setCurrentUser } = useStore();
  const [form, setForm] = useState({
    newUsername: currentUser?.username === "admin" ? "" : (currentUser?.username ?? ""),
    newPassword: "", confirmPassword: "",
    fullName: "", email: "", phone: "", idNumber: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = async () => {
    setError("");
    if (!form.newUsername.trim()) { setError("Username is required."); return; }
    if (form.newPassword !== form.confirmPassword) { setError("Passwords do not match."); return; }
    if (form.newPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (!form.fullName.trim()) { setError("Full name is required."); return; }

    setLoading(true);
    try {
      const result: any = await invoke("setup_profile", {
        input: {
          newUsername: form.newUsername.trim(),
          newPassword: form.newPassword,
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          idNumber: form.idNumber.trim(),
        },
      });
      // Show recovery code before proceeding
      setRecoveryCode(result.recoveryCode);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (recoveryCode) {
      navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleContinue = () => {
    // Re-fetch session and update store — triggers App.tsx to switch to Layout
    invoke<any>("get_session").then((s) => {
      if (s) setCurrentUser(s);
    });
  };

  // ── Recovery code screen ──────────────────────────────────────────────────
  if (recoveryCode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-kibt-green-dark to-kibt-green flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0">
              <Key size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Save Your Recovery Code</h1>
              <p className="text-sm text-red-600 font-medium">This is shown ONCE and cannot be retrieved again.</p>
            </div>
          </div>

          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5 mb-5">
            <p className="text-xs text-amber-700 mb-2 font-medium">Recovery Code</p>
            <div className="flex items-center justify-between gap-3">
              <code className="text-2xl font-bold text-gray-900 tracking-widest">{recoveryCode}</code>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-200 hover:bg-amber-300 text-amber-800 rounded-lg text-xs font-medium transition-colors"
              >
                {copied ? <><CheckCircle size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
              </button>
            </div>
          </div>

          <div className="bg-red-50 rounded-xl p-4 mb-5 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700 font-medium">Write this code down on paper and store it safely.</p>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700">Use it if you ever forget your password.</p>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700">The code can only be used once, then it becomes invalid.</p>
            </div>
          </div>

          <label className="flex items-start gap-3 mb-5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 w-4 h-4 accent-kibt-green flex-shrink-0"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span className="text-sm text-gray-700">
              I have written down or copied my recovery code and stored it safely.
            </span>
          </label>

          <button
            className="btn-primary w-full justify-center py-3 text-base"
            disabled={!confirmed}
            onClick={handleContinue}
          >
            <ShieldCheck size={18} /> Continue to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Setup form ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-kibt-green-dark to-kibt-green flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-kibt-green flex items-center justify-center flex-shrink-0">
            <ShieldCheck size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Set Up Your Account</h1>
            <p className="text-sm text-gray-500">Create your personal credentials before continuing.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Login Credentials</p>
            <div>
              <label className="label">New Username *</label>
              <div className="relative">
                <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input pl-8 text-sm" placeholder="Choose a username (min 3 characters)"
                  value={form.newUsername} onChange={set("newUsername")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">New Password * (min 8 chars)</label>
                <div className="relative">
                  <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-8 pr-8 text-sm"
                    type={showPw ? "text" : "password"} placeholder="New password"
                    value={form.newPassword} onChange={set("newPassword")} />
                  <button onClick={() => setShowPw(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Confirm Password *</label>
                <input className="input text-sm" type="password" placeholder="Repeat password"
                  value={form.confirmPassword} onChange={set("confirmPassword")} />
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Personal Information</p>
            <div>
              <label className="label">Full Name *</label>
              <div className="relative">
                <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input pl-8 text-sm" placeholder="Your full name"
                  value={form.fullName} onChange={set("fullName")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Email</label>
                <div className="relative">
                  <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-8 text-sm" placeholder="email@kibt.go.ke"
                    value={form.email} onChange={set("email")} />
                </div>
              </div>
              <div>
                <label className="label">Phone Number</label>
                <div className="relative">
                  <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-8 text-sm" placeholder="07xx xxx xxx"
                    value={form.phone} onChange={set("phone")} />
                </div>
              </div>
              <div className="col-span-2">
                <label className="label">National ID Number</label>
                <div className="relative">
                  <CreditCard size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-8 text-sm" placeholder="ID number"
                    value={form.idNumber} onChange={set("idNumber")} />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 rounded-xl px-4 py-3 text-xs text-blue-700">
            <strong>After saving</strong> you will receive a <strong>recovery code</strong>. 
            Write it down — it's the only way to recover your account if you forget your password.
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}

          <button
            className="btn-primary w-full justify-center py-2.5"
            onClick={handleSubmit}
            disabled={loading || !form.newPassword || !form.fullName.trim() || !form.newUsername.trim()}
          >
            {loading
              ? <><Loader size={15} className="animate-spin" /> Saving…</>
              : "Save & Get Recovery Code"}
          </button>
        </div>
      </div>
    </div>
  );
}
