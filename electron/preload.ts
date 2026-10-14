import { contextBridge, ipcRenderer } from "electron";
import type { BackendAuditEvent } from "../src/backend/types.ts";

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  isPackaged: process.env.NODE_ENV === "production",
  backend: {
    mode: "electron-local-file",
    readWorkspace: () => ipcRenderer.invoke("backend:read-workspace"),
    writeWorkspace: (workspace: string) => ipcRenderer.invoke("backend:write-workspace", workspace),
    appendAudit: (event: BackendAuditEvent) => ipcRenderer.invoke("backend:append-audit", event),
  },
});
