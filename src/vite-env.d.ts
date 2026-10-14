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

  interface ImportMetaEnv {
    readonly VITE_GOOGLE_CLIENT_ID: string;
    readonly VITE_GOOGLE_CLIENT_SECRET: string;
  }
}

declare const __GOOGLE_CLIENT_ID__: string;
declare const __GOOGLE_CLIENT_SECRET__: string;
