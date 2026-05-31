import { Outlet, NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Calendar, ScanLine, Users, BarChart3,
  Download, Settings, Wifi, WifiOff, UserCog, LogOut, ChevronDown, ScrollText, FileUp,
} from "lucide-react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";
import FYSelector from "./FYSelector";

const ALL_NAV = [
  { to: "/dashboard",    icon: LayoutDashboard, label: "Dashboard",        minRole: "user"        },
  { to: "/events",       icon: Calendar,        label: "Events",           minRole: "user"        },
  { to: "/scan",         icon: ScanLine,        label: "Scan Sheet",       minRole: "user"        },
  { to: "/import",       icon: FileUp,           label: "Import Data",      minRole: "user"        },
  { to: "/participants", icon: Users,            label: "Participants",     minRole: "user"        },
  { to: "/reports",      icon: BarChart3,        label: "Reports",         minRole: "user"        },
  { to: "/export",       icon: Download,         label: "Export",          minRole: "admin"       },
  { to: "/users",        icon: UserCog,          label: "Users",           minRole: "admin"       },
  { to: "/logs",         icon: ScrollText,        label: "Audit Logs",      minRole: "admin"       },
  { to: "/settings",     icon: Settings,         label: "Settings",        minRole: "admin"       },
];

function roleLevel(role: string) {
  return role === "super_admin" ? 3 : role === "admin" ? 2 : 1;
}

export default function Layout() {
  const { isOnline, currentUser, setCurrentUser } = useStore();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const userLevel = roleLevel(currentUser?.role ?? "user");
  const visibleNav = ALL_NAV.filter(n => userLevel >= roleLevel(n.minRole));

  const handleLogout = async () => {
    await invoke("logout");
    setCurrentUser(null);
    setShowUserMenu(false);
  };

  const roleLabel: Record<string, string> = {
    super_admin: "Super Admin", admin: "Admin", user: "Staff",
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 bg-kibt-green-dark flex flex-col">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-white/10">
          <div className="text-white font-bold text-base leading-tight">KIBT-AMS</div>
          <div className="text-white/60 text-xs mt-0.5">Attendance Management</div>
        </div>

        {/* FY Selector */}
        <div className="px-4 pt-4 pb-2">
          <FYSelector />
        </div>

        {/* Nav Links */}
        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
          {visibleNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/15 text-white"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`
              }
            >
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>

        {/* Connectivity */}
        <div className="px-4 py-2 border-t border-white/10">
          <div className={`flex items-center gap-2 text-xs font-medium ${isOnline ? "text-green-300" : "text-amber-300"}`}>
            {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
            {isOnline ? "Online — Gemini ready" : "Offline — Using Tesseract"}
          </div>
        </div>

        {/* User profile pill */}
        <div className="px-3 pb-4 relative">
          <button
            onClick={() => setShowUserMenu(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-full bg-kibt-gold flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {(currentUser?.fullName?.[0] ?? currentUser?.username?.[0] ?? "?").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">
                {currentUser?.fullName ?? currentUser?.username}
              </p>
              <p className="text-white/50 text-xs truncate">
                {roleLabel[currentUser?.role ?? "user"]}
              </p>
            </div>
            <ChevronDown size={12} className="text-white/50 flex-shrink-0" />
          </button>

          {showUserMenu && (
            <div className="absolute bottom-full left-3 right-3 mb-1 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-gray-50">
                <p className="text-sm font-semibold text-gray-800">
                  {currentUser?.fullName ?? currentUser?.username}
                </p>
                <p className="text-xs text-gray-400">@{currentUser?.username}</p>
                <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                  currentUser?.role === "super_admin" ? "bg-purple-100 text-purple-700"
                  : currentUser?.role === "admin" ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-600"
                }`}>
                  {roleLabel[currentUser?.role ?? "user"]}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto" onClick={() => showUserMenu && setShowUserMenu(false)}>
        <Outlet />
      </main>
    </div>
  );
}
