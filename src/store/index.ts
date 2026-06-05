import { create } from "zustand";
import { AppConfig } from "../types";

export interface SessionUser {
  id: string; username: string; role: string;
  fullName?: string; mustChangePassword: boolean;
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

  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

export interface Toast {
  id: string; message: string; type: "success" | "error" | "info" | "warning";
}

function currentKenyaFY(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return month >= 7 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

export const useStore = create<AppStore>((set) => ({
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

  toasts: [],
  addToast: (toast) =>
    set((state) => ({ toasts: [...state.toasts, { ...toast, id: crypto.randomUUID() }] })),
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
