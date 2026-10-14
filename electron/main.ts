import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
} from "electron";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { SerializedAtomicFileStore, resolveApplicationDataFile } from "./persistence.ts";
import { parseBackup } from "../src/crm/engine.ts";
import {
  assertBackendWorkspacePayload,
  parseBackendAuditEvent,
  parseBackendWorkspaceTextWithMigration,
  type BackendAuditEvent,
  type BackendWorkspaceEnvelope,
} from "../src/backend/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererDirectory = resolve(__dirname, "../renderer");
const developmentUrl = process.env.ELECTRON_RENDERER_URL ?? "http://127.0.0.1:5173";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

function isAllowedNavigation(url: string): boolean {
  if (url.startsWith("app://renderer/")) return true;
  if (!app.isPackaged && url.startsWith(developmentUrl)) return true;
  return false;
}

function registerProductionProtocol(): void {
  if (!app.isPackaged) return;

  protocol.handle("app", (request) => {
    const requestUrl = new URL(request.url);
    const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "") || "index.html";
    const candidate = resolve(rendererDirectory, relativePath);
    const root = resolve(rendererDirectory);

    if (candidate !== root && !candidate.startsWith(`${root}/`) && !candidate.startsWith(`${root}\\`)) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(candidate).toString());
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#f6f7fb",
    title: "Gallivanter",
    webPreferences: {
      preload: resolve(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });

  if (app.isPackaged) {
    void window.loadURL("app://renderer/index.html");
  } else {
    void window.loadURL(developmentUrl);
  }

  return window;
}

const BACKEND_WORKSPACE_FILE = "gallivanting-backend.json";
const BACKEND_AUDIT_FILE = "gallivanting-backend-audit.ndjson";

async function backendStores(): Promise<{ workspace: SerializedAtomicFileStore; audit: SerializedAtomicFileStore }> {
  const directory = app.getPath("userData");
  await mkdir(directory, { recursive: true });
  return {
    workspace: new SerializedAtomicFileStore(resolveApplicationDataFile(directory, BACKEND_WORKSPACE_FILE)),
    audit: new SerializedAtomicFileStore(resolveApplicationDataFile(directory, BACKEND_AUDIT_FILE)),
  };
}

function registerLocalBackend(): void {
  const stores = backendStores();

  ipcMain.handle("backend:read-workspace", async () => {
    const { workspace } = await stores;
    const raw = await workspace.read();
    if (raw === null) return null;
    const payload = parseBackendWorkspaceTextWithMigration(raw).workspace;
    if (payload === "") return null;
    parseBackup(payload);
    return payload;
  });

  ipcMain.handle("backend:write-workspace", async (_event, workspace: unknown) => {
    const payload = assertBackendWorkspacePayload(workspace);
    parseBackup(payload);
    const { workspace: store } = await stores;
    await store.update((raw) => {
      const current: BackendWorkspaceEnvelope = raw === null
        ? { version: 1, updatedAt: new Date().toISOString(), workspace: "", audit: [] }
        : parseBackendWorkspaceTextWithMigration(raw);
      return JSON.stringify({ ...current, version: 1, updatedAt: new Date().toISOString(), workspace: payload });
    });
  });

  ipcMain.handle("backend:append-audit", async (_event, event: unknown) => {
    const parsedEvent: BackendAuditEvent = parseBackendAuditEvent(event);
    const { workspace, audit } = await stores;
    await workspace.update((raw) => {
      const current: BackendWorkspaceEnvelope = raw === null
        ? { version: 1, updatedAt: new Date().toISOString(), workspace: "", audit: [] }
        : parseBackendWorkspaceTextWithMigration(raw);
      return JSON.stringify({
        ...current,
        version: 1,
        updatedAt: new Date().toISOString(),
        audit: [...current.audit.slice(-199), parsedEvent],
      });
    });
    await audit.append(`${JSON.stringify(parsedEvent)}\n`);
  });
}

app.whenReady().then(() => {
  // Remove the default menu entirely, so Alt cannot reveal it on Windows.
  // Keep the native title bar and window controls.
  Menu.setApplicationMenu(null);
  registerProductionProtocol();
  registerLocalBackend();

  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
          ],
        },
      });
    });
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
