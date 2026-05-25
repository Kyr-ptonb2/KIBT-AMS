import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import SetupProfilePage from "./pages/SetupProfilePage";
import Dashboard from "./pages/Dashboard";
import Events from "./pages/Events";
import ScanSheet from "./pages/ScanSheet";
import Participants from "./pages/Participants";
import Reports from "./pages/Reports";
import Export from "./pages/Export";
import Settings from "./pages/Settings";
import UserManagement from "./pages/UserManagement";
import LogsPage from "./pages/LogsPage";
import { useStore } from "./store";
import { checkConnectivity, getConfig, getFinancialYears } from "./hooks/useTauri";
import ToastContainer from "./components/ToastContainer";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function App() {
  const { currentUser, setCurrentUser, setIsOnline, setConfig, setFinancialYears, selectedFY, setSelectedFY } = useStore();

  // Check for existing session on startup
  useEffect(() => {
    invoke<any>("get_session").then((session) => {
      if (session) setCurrentUser(session);
    }).catch(() => {});
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
    const iv = setInterval(async () => {
      setIsOnline(await checkConnectivity().catch(() => false));
    }, 30_000);
    return () => clearInterval(iv);
  }, [currentUser]);

  // Not logged in → Login page
  if (!currentUser) {
    return (
      <QueryClientProvider client={queryClient}>
        <LoginPage />
        <ToastContainer />
      </QueryClientProvider>
    );
  }

  // Logged in but must change password → Setup page
  if (currentUser.mustChangePassword) {
    return (
      <QueryClientProvider client={queryClient}>
        <SetupProfilePage />
        <ToastContainer />
      </QueryClientProvider>
    );
  }

  // Full app
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard"    element={<Dashboard />} />
            <Route path="events"       element={<Events />} />
            <Route path="scan"         element={<ScanSheet />} />
            <Route path="participants" element={<Participants />} />
            <Route path="reports"      element={<Reports />} />
            <Route path="export"       element={<AdminOnly><Export /></AdminOnly>} />
            <Route path="settings"     element={<AdminOnly><Settings /></AdminOnly>} />
            <Route path="users"        element={<AdminOnly><UserManagement /></AdminOnly>} />
            <Route path="logs"         element={<AdminOnly><LogsPage /></AdminOnly>} />
          </Route>
        </Routes>
        <ToastContainer />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

// Only admins can access these routes
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
