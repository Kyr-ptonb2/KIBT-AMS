import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Lock, User, Eye, EyeOff, Loader, KeyRound, ArrowLeft, CheckCircle, Briefcase } from "lucide-react";
import { useStore } from "../store";

type Screen = "login" | "recovery_step1" | "recovery_step2" | "recovery_done";

export default function LoginPage() {
  const { setCurrentUser } = useStore();
  const [screen, setScreen] = useState<Screen>("login");

  // Login state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Recovery state
  const [recUsername, setRecUsername] = useState("");
  const [recCode, setRecCode] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");

  const handleLogin = async () => {
    if (!username.trim() || !password) return;
    setLoading(true); setError("");
    try {
      const result: any = await invoke("login", {
        input: { username: username.trim(), password },
      });
      if (result.success) {
        setCurrentUser(result.user);
      } else {
        setError(result.error ?? "Login failed.");
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRecoveryStep1 = async () => {
    if (!recUsername.trim()) return;
    setRecLoading(true); setRecError("");
    try {
      const result: any = await invoke("verify_recovery_code", {
        username: recUsername.trim(),
      });
      if (result.success) {
        setScreen("recovery_step2");
      } else {
        setRecError(result.error ?? "Username not found.");
      }
    } catch (e: any) {
      setRecError(String(e));
    } finally {
      setRecLoading(false);
    }
  };

  const handleRecoveryStep2 = async () => {
    setRecError("");
    if (newPw !== confirmPw) { setRecError("Passwords do not match."); return; }
    if (newPw.length < 8)    { setRecError("Password must be at least 8 characters."); return; }
    if (!recCode.trim())     { setRecError("Recovery code is required."); return; }

    setRecLoading(true);
    try {
      const result: any = await invoke("reset_password_with_code", {
        username: recUsername.trim(),
        recoveryCode: recCode.trim().toUpperCase(),
        newPassword: newPw,
      });
      if (result.success) {
        setScreen("recovery_done");
      } else {
        setRecError(result.error ?? "Recovery failed.");
      }
    } catch (e: any) {
      setRecError(String(e));
    } finally {
      setRecLoading(false);
    }
  };

  // ── Login screen ──────────────────────────────────────────────────────────
  if (screen === "login") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-kibt-green-dark to-kibt-green flex items-center justify-center p-4">
        <div className="rounded-2xl shadow-2xl w-full max-w-sm p-8" style={{ backgroundColor: "var(--bg-card)", boxShadow: "0 8px 40px rgb(0 0 0 / 0.25)" }}>
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-kibt-green flex items-center justify-center mx-auto mb-4">
              <Briefcase size={32} className="text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">KIBT-AMS</h1>
            <p className="text-sm text-gray-500 mt-1">Attendance Management System</p>
            <p className="text-xs text-gray-400 mt-0.5">Kenya Institute of Business Training</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="label">Username</label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input pl-9" placeholder="Enter username"
                  value={username} onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()} autoFocus />
              </div>
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input pl-9 pr-10"
                  type={showPw ? "text" : "password"} placeholder="Enter password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
                <button onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
            )}

            <button className="btn-primary w-full justify-center py-2.5 mt-2"
              onClick={handleLogin}
              disabled={loading || !username.trim() || !password}>
              {loading ? <><Loader size={15} className="animate-spin" /> Signing in…</> : "Sign In"}
            </button>

            <button
              onClick={() => { setScreen("recovery_step1"); setRecError(""); }}
              className="w-full text-center text-xs text-kibt-green hover:underline mt-1"
            >
              Forgot your password?
            </button>
          </div>

          <p className="text-xs text-center text-gray-400 mt-6">
            First time? Use: <code className="bg-gray-100 px-1 rounded">admin</code> / <code className="bg-gray-100 px-1 rounded">Kibt@2024</code>
          </p>
        </div>
      </div>
    );
  }

  // ── Recovery Step 1: enter username ──────────────────────────────────────
  if (screen === "recovery_step1") {
    return (
      <RecoveryCard title="Recover Your Account" subtitle="Enter your username to begin">
        <div className="space-y-4">
          <div>
            <label className="label">Your Username</label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9" placeholder="Enter your username"
                value={recUsername} onChange={(e) => setRecUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRecoveryStep1()} autoFocus />
            </div>
          </div>
          {recError && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{recError}</div>}
          <button className="btn-primary w-full justify-center" onClick={handleRecoveryStep1}
            disabled={recLoading || !recUsername.trim()}>
            {recLoading ? <><Loader size={14} className="animate-spin" /> Checking…</> : "Next →"}
          </button>
          <button onClick={() => setScreen("login")}
            className="w-full flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            <ArrowLeft size={12} /> Back to login
          </button>
          <p className="text-xs text-gray-400 text-center">
            No recovery code? Ask your Super Admin to reset your password.
          </p>
        </div>
      </RecoveryCard>
    );
  }

  // ── Recovery Step 2: enter code + new password ────────────────────────────
  if (screen === "recovery_step2") {
    return (
      <RecoveryCard title="Enter Recovery Code" subtitle={`Account: ${recUsername}`}>
        <div className="space-y-4">
          <div>
            <label className="label">Recovery Code</label>
            <div className="relative">
              <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9 font-mono tracking-widest uppercase"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={recCode}
                onChange={(e) => setRecCode(e.target.value.toUpperCase())}
                maxLength={19} />
            </div>
            <p className="text-xs text-gray-400 mt-1">Enter the code you saved during account setup.</p>
          </div>
          <div>
            <label className="label">New Password (min 8 characters)</label>
            <input className="input" type="password" placeholder="New password"
              value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </div>
          <div>
            <label className="label">Confirm New Password</label>
            <input className="input" type="password" placeholder="Repeat password"
              value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </div>
          {recError && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{recError}</div>}
          <button className="btn-primary w-full justify-center" onClick={handleRecoveryStep2}
            disabled={recLoading || !recCode.trim() || !newPw || !confirmPw}>
            {recLoading ? <><Loader size={14} className="animate-spin" /> Resetting…</> : "Reset Password"}
          </button>
          <button onClick={() => setScreen("recovery_step1")}
            className="w-full flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            <ArrowLeft size={12} /> Back
          </button>
        </div>
      </RecoveryCard>
    );
  }

  // ── Recovery done ─────────────────────────────────────────────────────────
  return (
    <RecoveryCard title="Password Reset!" subtitle="You can now log in with your new password">
      <div className="space-y-4">
        <div className="flex justify-center py-4">
          <CheckCircle size={48} className="text-green-500" />
        </div>
        <p className="text-sm text-gray-600 text-center">
          Your password has been reset. You will be required to set a new one on first login.
        </p>
        <button className="btn-primary w-full justify-center"
          onClick={() => { setScreen("login"); setRecCode(""); setNewPw(""); setConfirmPw(""); }}>
          Go to Login
        </button>
      </div>
    </RecoveryCard>
  );
}

function RecoveryCard({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-kibt-green-dark to-kibt-green flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <KeyRound size={18} className="text-amber-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
