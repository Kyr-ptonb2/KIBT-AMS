import { useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import SetupProfilePage from "./pages/SetupProfilePage";
import { useStore } from "./store";
import { checkConnectivity, getConfig, getFinancialYears } from "./hooks/useTauri";
import ToastContainer from "./components/ToastContainer";

// ── Lazy-load all heavy pages — they only download when first visited ─────────
const Dashboard        = lazy(() => import("./pages/Dashboard"));
const Events           = lazy(() => import("./pages/Events"));
const ScanSheet        = lazy(() => import("./pages/ScanSheet"));
const Participants     = lazy(() => import("./pages/Participants"));
const Reports          = lazy(() => import("./pages/Reports"));
const Export           = lazy(() => import("./pages/Export"));
const Settings         = lazy(() => import("./pages/Settings"));
const UserManagement   = lazy(() => import("./pages/UserManagement"));
const LogsPage         = lazy(() => import("./pages/LogsPage"));
const ImportParticipants = lazy(() => import("./pages/ImportParticipants"));
const CustomTables     = lazy(() => import("./pages/CustomTables"));

// Lightweight spinner shown while a lazy page loads
function PageSkeleton() {
  return (
    <div className="flex items-center justify-center h-full min-h-64 text-gray-300 text-sm">
      <div className="flex flex-col items-center gap-2">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-kibt-green rounded-full animate-spin" />
        <span className="text-xs">Loading…</span>
      </div>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 3 * 60_000,   // 3 min — data stays fresh, no unnecessary refetch
      gcTime:    15 * 60_000,  // 15 min — keep in memory after unmount
      refetchOnWindowFocus: false,  // don't refetch just because user clicked back to app
    },
  },
});

export default function App() {
  const {
    currentUser, setCurrentUser,
    setIsOnline, setConfig,
    setFinancialYears, selectedFY, setSelectedFY,
    theme,
  } = useStore();

  // Apply saved theme on startup
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Restore session on startup
  useEffect(() => {
    invoke<any>("get_session").then((s) => { if (s) setCurrentUser(s); }).catch(() => {});
  }, []);

  // Load app data once logged in
  useEffect(() => {
    if (!currentUser || currentUser.mustChangePassword) return;

    const init = async () => {
      try {
        const [online, config, years] = await Promise.all([
          checkConnectivity(), getConfig(), getFinancialYears(),
        ]);
        setIsOnline(online);
        setConfig(config);
        if (years.length > 0) {
          setFinancialYears(years);
          if (!years.includes(selectedFY)) setSelectedFY(years[0]);
        }
      } catch {}
    };
    init();

    // Poll connectivity every 60s (was 30s) — halves background wake-ups
    const iv = setInterval(async () => {
      setIsOnline(await checkConnectivity().catch(() => false));
    }, 60_000);
    return () => clearInterval(iv);
  }, [currentUser]);

  if (!currentUser) {
    return (
      <QueryClientProvider client={queryClient}>
        <LoginPage />
        <ToastContainer />
      </QueryClientProvider>
    );
  }

  if (currentUser.mustChangePassword) {
    return (
      <QueryClientProvider client={queryClient}>
        <SetupProfilePage />
        <ToastContainer />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard"    element={<Suspense fallback={<PageSkeleton />}><Dashboard /></Suspense>} />
            <Route path="events"       element={<Suspense fallback={<PageSkeleton />}><Events /></Suspense>} />
            <Route path="scan"         element={<Suspense fallback={<PageSkeleton />}><ScanSheet /></Suspense>} />
            <Route path="participants" element={<Suspense fallback={<PageSkeleton />}><Participants /></Suspense>} />
            <Route path="reports"      element={<Suspense fallback={<PageSkeleton />}><Reports /></Suspense>} />
            <Route path="import"       element={<Suspense fallback={<PageSkeleton />}><ImportParticipants /></Suspense>} />
            <Route path="custom-tables" element={<Suspense fallback={<PageSkeleton />}><CustomTables /></Suspense>} />
            <Route path="export"       element={<AdminOnly><Suspense fallback={<PageSkeleton />}><Export /></Suspense></AdminOnly>} />
            <Route path="settings"     element={<AdminOnly><Suspense fallback={<PageSkeleton />}><Settings /></Suspense></AdminOnly>} />
            <Route path="users"        element={<AdminOnly><Suspense fallback={<PageSkeleton />}><UserManagement /></Suspense></AdminOnly>} />
            <Route path="logs"         element={<AdminOnly><Suspense fallback={<PageSkeleton />}><LogsPage /></Suspense></AdminOnly>} />
          </Route>
        </Routes>
        <ToastContainer />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { currentUser } = useStore();
  if (!currentUser) return <Navigate to="/" replace />;
  if (currentUser.role === "user") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-700">Access Restricted</p>
          <p className="text-sm text-gray-400 mt-1">This section requires Admin access.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
