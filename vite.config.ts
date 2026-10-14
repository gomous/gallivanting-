import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Proxy API/auth/drive requests to the Cloudflare Worker during development
    proxy: {
      "/auth": {
        target: "https://gallivanter-api.jolly-rain-7712.workers.dev",
        changeOrigin: true,
        secure: false,
      },
      "/drive": {
        target: "https://gallivanter-api.jolly-rain-7712.workers.dev",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
  },
});

