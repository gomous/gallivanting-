/// <reference types="vite/client" />

import type { BackendDesktopApi } from "./backend/types.ts";

declare global {
  interface Window {
    desktop?: {
      platform: NodeJS.Platform;
      isPackaged: boolean;
      backend?: BackendDesktopApi;
    };
  }
}
