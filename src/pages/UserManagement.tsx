import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  UserPlus, Trash2, Shield, ShieldCheck, User as UserIcon,
  Eye, EyeOff, RotateCcw, LogOut
} from "lucide-react";
import { useStore } from "../store";
import PageHeader from "../components/PageHeader";

interface User {
  id: string; username: string; role: string;
  fullName?: string; email?: string; phone?: string; idNumber?: string;
  mustChangePassword: boolean; createdBy?: string; createdAt: string; lastLogin?: string;
}

const ROLE_LABELS: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string }> = {
  super_admin: { label: "Super Admin", icon: <ShieldCheck size={12} />, bg: "bg-purple-100", text: "text-purple-700" },
  admin:       { label: "Admin",       icon: <Shield size={12} />,      bg: "bg-blue-100",   text: "text-blue-700"   },
  user:        { label: "Staff",       icon: <UserIcon size={12} />,    bg: "bg-gray-100",   text: "text-gray-600"   },
};

function RoleBadge({ role }: { role: string }) {
  const r = ROLE_LABELS[role] ?? ROLE_LABELS.user;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${r.bg} ${r.text}`}>
      {r.icon} {r.label}
    </span>
  );
}

export default function UserManagement() {
  const { currentUser, setCurrentUser, addToast } = useStore();
  const qc = useQueryClient();
  const isSuperAdmin = currentUser?.role === "super_admin";
  const [showCreate, setShowCreate] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);

  const { data: users } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => invoke("get_users"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => invoke("delete_user", { userId: id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); addToast({ type: "success", message: "User deleted." }); },
    onError: (e: any) => addToast({ type: "error", message: String(e) }),
  });

  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => invoke("set_user_role", { userId: id, role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); addToast({ type: "success", message: "Role updated." }); },
    onError: (e: any) => addToast({ type: "error", message: String(e) }),
  });

  const handleLogout = async () => {
    await invoke("logout");
    setCurrentUser(null);
  };

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title="User Management"
        subtitle="Manage system accounts and access levels"
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <UserPlus size={14} /> Add User
          </button>
        }
      />

      <div className="px-8 py-6 space-y-5">
        {/* Current session info */}
        <div className="card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-kibt-green flex items-center justify-center text-white text-sm font-bold">
              {currentUser?.fullName?.[0] ?? currentUser?.username?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {currentUser?.fullName ?? currentUser?.username}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <RoleBadge role={currentUser?.role ?? "user"} />
                <span className="text-xs text-gray-400">@{currentUser?.username}</span>
              </div>
            </div>
          </div>
          <button className="btn-secondary text-xs" onClick={handleLogout}>
            <LogOut size={13} /> Sign Out
          </button>
        </div>

        {/* Create user form */}
        {showCreate && (
          <CreateUserForm
            isSuperAdmin={isSuperAdmin}
            onSuccess={() => { qc.invalidateQueries({ queryKey: ["users"] }); setShowCreate(false); addToast({ type: "success", message: "User created. They must set their password on first login." }); }}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {/* Reset password dialog */}
        {resetUserId && (
          <ResetPasswordForm
            userId={resetUserId}
            onSuccess={() => { setResetUserId(null); addToast({ type: "success", message: "Password reset. User must change it on next login." }); }}
            onCancel={() => setResetUserId(null)}
          />
        )}

        {/* Users list */}
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Contact</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Last Login</th>
                <th className="px-3 py-3 font-medium">Created By</th>
                <th className="px-3 py-3 font-medium w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users?.map((u) => {
                const isMe = u.id === currentUser?.id;
                return (
                  <tr key={u.id} className={`hover:bg-gray-50 ${isMe ? "bg-green-50/30" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                          {(u.fullName?.[0] ?? u.username[0]).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">{u.fullName ?? u.username}</p>
                          <p className="text-xs text-gray-400">@{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {isSuperAdmin && !isMe ? (
                        <select
                          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                          value={u.role}
                          onChange={(e) => roleMut.mutate({ id: u.id, role: e.target.value })}
                        >
                          <option value="user">Staff</option>
                          <option value="admin">Admin</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                      ) : <RoleBadge role={u.role} />}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">
                      {u.email && <p>{u.email}</p>}
                      {u.phone && <p>{u.phone}</p>}
                    </td>
                    <td className="px-3 py-3">
                      {u.mustChangePassword
                        ? <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Must change password</span>
                        : <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Active</span>}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString("en-KE") : "Never"}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">{u.createdBy ?? "—"}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        <button
                          title="Reset password"
                          className="p-1.5 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50"
                          onClick={() => setResetUserId(u.id)}
                        >
                          <RotateCcw size={13} />
                        </button>
                        {isSuperAdmin && !isMe && (
                          <button
                            title="Delete user"
                            className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                            onClick={() => {
                              if (confirm(`Delete user "${u.username}"? This cannot be undone.`)) {
                                deleteMut.mutate(u.id);
                              }
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Permissions reference */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Permission Levels</h3>
          <div className="grid grid-cols-3 gap-3 text-xs">
            {[
              { role: "super_admin", label: "Super Admin", perms: ["Everything below", "Delete events & participants", "User management", "Promote/demote admins", "Database backup/restore"] },
              { role: "admin", label: "Admin", perms: ["Everything below", "Delete events & participants", "Export data", "Settings"] },
              { role: "user", label: "Staff", perms: ["Create events", "Scan attendance sheets", "View participants", "View reports"] },
            ].map(({ role, label, perms }) => {
              const r = ROLE_LABELS[role];
              return (
                <div key={role} className="bg-gray-50 rounded-xl p-3">
                  <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${r.bg} ${r.text} mb-2`}>
                    {r.icon} {label}
                  </div>
                  <ul className="space-y-1">
                    {perms.map(p => (
                      <li key={p} className="flex items-start gap-1.5 text-gray-600">
                        <span className="text-green-500 mt-0.5">✓</span> {p}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateUserForm({ isSuperAdmin, onSuccess, onCancel }: {
  isSuperAdmin: boolean; onSuccess: () => void; onCancel: () => void;
}) {
  const { addToast } = useStore();
  const [form, setForm] = useState({
    username: "", password: "", role: "user",
    fullName: "", email: "", phone: "", idNumber: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const handleCreate = async () => {
    setLoading(true);
    try {
      await invoke("create_user", { input: { ...form, fullName: form.fullName || null, email: form.email || null, phone: form.phone || null, idNumber: form.idNumber || null } });
      onSuccess();
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally { setLoading(false); }
  };

  return (
    <div className="card p-5 border-2 border-kibt-green/20">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">New User Account</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Username *</label>
          <input className="input text-sm" placeholder="username" value={form.username} onChange={set("username")} />
        </div>
        <div>
          <label className="label">Temporary Password *</label>
          <div className="relative">
            <input className="input pr-8 text-sm" type={showPw ? "text" : "password"}
              placeholder="min 8 chars" value={form.password} onChange={set("password")} />
            <button onClick={() => setShowPw(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
              {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>
        <div>
          <label className="label">Role *</label>
          <select className="select text-sm" value={form.role} onChange={set("role")}>
            <option value="user">Staff (no delete)</option>
            {isSuperAdmin && <option value="admin">Admin (full access)</option>}
          </select>
        </div>
        <div>
          <label className="label">Full Name</label>
          <input className="input text-sm" placeholder="Optional — user can set later" value={form.fullName} onChange={set("fullName")} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input text-sm" placeholder="Optional" value={form.email} onChange={set("email")} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input text-sm" placeholder="Optional" value={form.phone} onChange={set("phone")} />
        </div>
      </div>
      <p className="text-xs text-amber-600 mt-3">
        The user will be forced to change their password on first login.
      </p>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={handleCreate}
          disabled={loading || !form.username.trim() || !form.password}>
          {loading ? "Creating…" : "Create User"}
        </button>
      </div>
    </div>
  );
}

function ResetPasswordForm({ userId, onSuccess, onCancel }: {
  userId: string; onSuccess: () => void; onCancel: () => void;
}) {
  const { addToast } = useStore();
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    setLoading(true);
    try {
      await invoke("reset_user_password", { userId, newPassword: pw });
      onSuccess();
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally { setLoading(false); }
  };

  return (
    <div className="card p-5 border-2 border-amber-200">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Reset Password</h3>
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="label">New Temporary Password</label>
          <input className="input" type="password" placeholder="min 8 characters"
            value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={handleReset} disabled={loading || pw.length < 8}>
          {loading ? "Resetting…" : "Reset"}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
      <p className="text-xs text-gray-500 mt-2">User must change this password on next login.</p>
    </div>
  );
}
