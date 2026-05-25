import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { User, Lock, Mail, Phone, CreditCard, Eye, EyeOff, Loader, ShieldCheck } from "lucide-react";
import { useStore } from "../store";

export default function SetupProfilePage() {
  const { currentUser, setCurrentUser } = useStore();
  const [form, setForm] = useState({
    newUsername: currentUser?.username === "admin" ? "" : (currentUser?.username ?? ""),
    newPassword: "",
    confirmPassword: "",
    fullName: currentUser?.fullName ?? "",
    email: "",
    phone: "",
    idNumber: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = async () => {
    setError("");
    if (form.newPassword !== form.confirmPassword) {
      setError("Passwords do not match."); return;
    }
    if (form.newPassword.length < 8) {
      setError("Password must be at least 8 characters."); return;
    }
    if (!form.fullName.trim()) {
      setError("Full name is required."); return;
    }
    setLoading(true);
    try {
      const updated: any = await invoke("setup_profile", {
        input: {
          newUsername: form.newUsername.trim() || currentUser?.username,
          newPassword: form.newPassword,
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          idNumber: form.idNumber.trim(),
        },
      });
      setCurrentUser(updated);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-kibt-green-dark to-kibt-green flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-kibt-green flex items-center justify-center flex-shrink-0">
            <ShieldCheck size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Set Up Your Account</h1>
            <p className="text-sm text-gray-500">
              {currentUser?.role === "super_admin"
                ? "Welcome! Please set your credentials and personal profile before continuing."
                : "Your account requires a password change. Please update your details."}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Credentials */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Login Credentials</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">New Username *</label>
                <div className="relative">
                  <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-8 text-sm" placeholder="Choose a username"
                    value={form.newUsername} onChange={set("newUsername")} />
                </div>
              </div>
              <div className="col-span-2 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">New Password * (min 8 chars)</label>
                  <div className="relative">
                    <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input className="input pl-8 pr-8 text-sm" placeholder="New password"
                      type={showPw ? "text" : "password"}
                      value={form.newPassword} onChange={set("newPassword")} />
                    <button onClick={() => setShowPw(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                      {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">Confirm Password *</label>
                  <input className="input text-sm" placeholder="Repeat password"
                    type="password" value={form.confirmPassword} onChange={set("confirmPassword")} />
                </div>
              </div>
            </div>
          </div>

          {/* Personal Info */}
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
              <div>
                <label className="label">National ID Number</label>
                <div className="relative">
                  <CreditCard size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-8 text-sm" placeholder="ID number"
                    value={form.idNumber} onChange={set("idNumber")} />
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}

          <button
            className="btn-primary w-full justify-center py-2.5"
            onClick={handleSubmit}
            disabled={loading || !form.newPassword || !form.fullName.trim()}
          >
            {loading
              ? <><Loader size={15} className="animate-spin" /> Saving…</>
              : "Save & Continue to Dashboard"}
          </button>
        </div>
      </div>
    </div>
  );
}
