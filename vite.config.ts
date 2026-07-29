import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const localViteCache = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "Krama", "vite-cache")
  : path.resolve(__dirname, ".vite-cache");

// https://vitejs.dev/config/
export default defineConfig(() => ({
  // Keep Vite's frequently-read dependency cache outside the OneDrive-synced
  // project. This affects development tooling only; production output is unchanged.
  cacheDir: process.env.VITE_CACHE_DIR || localViteCache,
  server: {
    host: "127.0.0.1",
    port: 8080,
    strictPort: true,
    watch: {
      ignored: [
        "**/backend/**",
        "**/dist/**",
        "**/logs/**",
        "**/output/**",
        "**/tmp/**",
        "**/.runtime/**",
      ],
    },
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/App.tsx",
        "./src/pages/Index.tsx",
      ],
    },
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8082",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 8080,
    strictPort: true,
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "react-router-dom",
      "@tanstack/react-query",
    ],
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
