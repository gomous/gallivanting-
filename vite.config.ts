import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Proxy API requests to Cloudflare Pages Functions during development
    // In production, Pages Functions are served automatically from /functions/api/
    proxy: {
      "/api": {
        target: "http://localhost:8787",
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

