import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Lock, User, Eye, EyeOff, Loader } from "lucide-react";
import { useStore } from "../store";

export default function LoginPage() {
  const { setCurrentUser } = useStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!username.trim() || !password) return;
    setLoading(true); setError("");
    try {
      const result: any = await invoke("login", { input: { username: username.trim(), password } });
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-kibt-green-dark to-kibt-green flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-kibt-green flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">K</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">KIBT-AMS</h1>
          <p className="text-sm text-gray-500 mt-1">Attendance Management System</p>
          <p className="text-xs text-gray-400 mt-0.5">Kenya Institute of Business Training</p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="label">Username</label>
            <div className="relative">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="label">Password</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9 pr-10"
                type={showPw ? "text" : "password"}
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
              <button
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}

          <button
            className="btn-primary w-full justify-center py-2.5 mt-2"
            onClick={handleLogin}
            disabled={loading || !username.trim() || !password}
          >
            {loading ? <><Loader size={15} className="animate-spin" /> Signing in…</> : "Sign In"}
          </button>
        </div>

        <p className="text-xs text-center text-gray-400 mt-6">
          Contact your system administrator if you have trouble logging in.
        </p>
      </div>
    </div>
  );
}
