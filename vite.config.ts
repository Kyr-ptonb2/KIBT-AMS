import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },

  build: {
    // Raise the chunk warning threshold — our chunks are intentionally split
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        // Split vendor libraries into separate cacheable chunks
        manualChunks: {
          // React core — changes rarely, stays cached
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          // Data layer — TanStack Query + Zustand
          "vendor-data": ["@tanstack/react-query", "zustand"],
          // Heavy import-only lib — only loaded when Import page is visited
          "vendor-exceljs": ["exceljs"],
          // CSV parsing — small but kept separate
          "vendor-csv": ["papaparse"],
          // Icons — large, rarely changes
          "vendor-icons": ["lucide-react"],
        },
      },
    },

    // Minify with esbuild (default, fastest)
    minify: "esbuild",
    target: "es2020",

    // Remove console.log in production
    esbuildOptions: {
      drop: ["console", "debugger"],
      legalComments: "none",
    },
  },
}));
