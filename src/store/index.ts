import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AppConfig } from "../types";

export interface SessionUser {
  id: string; username: string; role: string;
  fullName?: string; mustChangePassword: boolean;
}

export interface Toast {
  id: string; message: string; type: "success" | "error" | "info" | "warning";
}

interface AppStore {
  currentUser: SessionUser | null;
  setCurrentUser: (user: SessionUser | null) => void;

  selectedFY: string;
  setSelectedFY: (fy: string) => void;

  financialYears: string[];
  setFinancialYears: (years: string[]) => void;

  isOnline: boolean;
  setIsOnline: (online: boolean) => void;

  config: AppConfig | null;
  setConfig: (config: AppConfig) => void;

  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;

  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

function currentKenyaFY(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return month >= 7 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

export const useStore = create<AppStore>()(
  persist(
    (set) => ({
      currentUser: null,
      setCurrentUser: (user) => set({ currentUser: user }),

      selectedFY: currentKenyaFY(),
      setSelectedFY: (fy) => set({ selectedFY: fy }),

      financialYears: [currentKenyaFY()],
      setFinancialYears: (years) => set({ financialYears: years }),

      isOnline: false,
      setIsOnline: (online) => set({ isOnline: online }),

      config: null,
      setConfig: (config) => set({ config }),

      theme: "light",
      setTheme: (theme) => {
        set({ theme });
        document.documentElement.setAttribute("data-theme", theme);
      },

      toasts: [],
      addToast: (toast) =>
        set((state) => ({ toasts: [...state.toasts, { ...toast, id: crypto.randomUUID() }] })),
      removeToast: (id) =>
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: "kibt-ams-prefs",
      // Only persist theme — everything else is re-fetched from backend
      partialize: (state) => ({ theme: state.theme }),
    }
  )
);
