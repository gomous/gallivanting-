import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve("electron/main.ts"),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve("electron/preload.ts"),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve("."),
    build: {
      rollupOptions: {
        input: resolve("index.html"),
      },
    },
    resolve: {
      alias: {
        "@renderer": resolve("src"),
      },
    },
    plugins: [react()],
  },
});
