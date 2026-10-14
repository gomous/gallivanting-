import {
  assertBackendWorkspacePayload,
  parseBackendAuditEvent,
  parseBackendWorkspaceEnvelopeWithMigration,
  type BackendAuditEvent,
  type BackendDesktopApi,
  type BackendStorageMode,
  type BackendWorkspaceEnvelope,
} from "./types.ts";

export const LOCAL_BACKEND_STORAGE_KEY = "gallivanting.backend.v1";

export type BackendPersistenceIssue = {
  operation: string;
  error: Error;
};

export type BackendIssueListener = (issue: BackendPersistenceIssue) => void;

export type LocalBackendEnvironment = {
  storage?: Storage | null;
  desktop?: BackendDesktopApi | null;
  now?: () => string;
  id?: () => string;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function now(): string {
  return new Date().toISOString();
}

function idToken(): string {
  const cryptoObject = globalThis.crypto as Crypto & { randomUUID?: () => string } | undefined;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultEnvelope(at: string): BackendWorkspaceEnvelope {
  return { version: 1, updatedAt: at, workspace: "", audit: [] };
}

/**
 * Renderer-side adapter for the same logical backend in a browser or Electron.
 * Browser state is stored in one localStorage envelope. Electron calls are
 * serialized here as well as in the main process, and failures are observable
 * through listeners rather than becoming unhandled promise rejections.
 */
export class ReliableLocalBackend {
  private readonly environment: LocalBackendEnvironment;
  private writeTail: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<BackendIssueListener>();

  public constructor(environment: LocalBackendEnvironment = {}) {
    this.environment = environment;
  }

  public get mode(): BackendStorageMode {
    return this.desktop()?.mode ?? "browser-local";
  }

  public subscribe(listener: BackendIssueListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public readCachedWorkspace(): string | null {
    const envelope = this.readEnvelope();
    return envelope.workspace || null;
  }

  public readCachedAudit(): BackendAuditEvent[] {
    return this.readEnvelope().audit.map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined }));
  }

  public async readWorkspace(): Promise<string | null> {
    const desktop = this.desktop();
    if (desktop?.mode === "electron-local-file") {
      const workspace = await desktop.readWorkspace();
      if (workspace !== null && typeof workspace !== "string") throw new Error("Desktop backend returned an invalid workspace payload.");
      return workspace;
    }
    return this.readCachedWorkspace();
  }

  public writeWorkspace(workspace: string): Promise<void> {
    const payload = assertBackendWorkspacePayload(workspace);
    const envelope = this.readEnvelope();
    this.writeEnvelope({ ...envelope, version: 1, updatedAt: this.clock(), workspace: payload });
    const desktop = this.desktop();
    if (!desktop || desktop.mode !== "electron-local-file") return Promise.resolve();
    return this.enqueue("workspace write", () => desktop.writeWorkspace(payload));
  }

  public appendAudit(event: BackendAuditEvent): Promise<void> {
    let parsedEvent: BackendAuditEvent;
    try {
      parsedEvent = parseBackendAuditEvent(event);
      const envelope = this.readEnvelope();
      this.writeEnvelope({
        ...envelope,
        version: 1,
        updatedAt: this.clock(),
        audit: [...envelope.audit.slice(-199), parsedEvent],
      });
    } catch (error: unknown) {
      this.report("audit append", error);
      return Promise.resolve();
    }

    const desktop = this.desktop();
    if (!desktop || desktop.mode !== "electron-local-file") return Promise.resolve();
    return this.enqueue("audit append", () => desktop.appendAudit(parsedEvent));
  }

  public async flush(): Promise<void> {
    await this.writeTail;
  }

  private storage(): Storage | null {
    if (Object.prototype.hasOwnProperty.call(this.environment, "storage")) return this.environment.storage ?? null;
    if (typeof window === "undefined") return null;
    return window.localStorage;
  }

  private desktop(): BackendDesktopApi | null {
    if (Object.prototype.hasOwnProperty.call(this.environment, "desktop")) return this.environment.desktop ?? null;
    if (typeof window === "undefined") return null;
    return window.desktop?.backend ?? null;
  }

  private clock(): string {
    return this.environment.now?.() ?? now();
  }

  private readEnvelope(): BackendWorkspaceEnvelope {
    const storage = this.storage();
    if (!storage) return defaultEnvelope(this.clock());
    const raw = storage.getItem(LOCAL_BACKEND_STORAGE_KEY);
    if (raw === null) return defaultEnvelope(this.clock());
    try {
      return parseBackendWorkspaceEnvelopeWithMigration(JSON.parse(raw) as unknown);
    } catch (error: unknown) {
      throw new Error(`Could not read local backend state: ${errorText(error)}`);
    }
  }

  private writeEnvelope(envelope: BackendWorkspaceEnvelope): void {
    const storage = this.storage();
    if (!storage) return;
    storage.setItem(LOCAL_BACKEND_STORAGE_KEY, JSON.stringify(envelope));
  }

  private enqueue(operation: string, task: () => Promise<void>): Promise<void> {
    const result = this.writeTail.then(task);
    this.writeTail = result.then(() => undefined, (error: unknown) => {
      this.report(operation, error);
    });
    return result;
  }

  private report(operation: string, error: unknown): void {
    const issue: BackendPersistenceIssue = { operation, error: asError(error) };
    for (const listener of this.listeners) {
      try {
        listener(issue);
      } catch {
        // A diagnostic listener must not break persistence or application code.
      }
    }
  }
}

const defaultBackend = new ReliableLocalBackend();

export function subscribeLocalBackendErrors(listener: BackendIssueListener): () => void {
  return defaultBackend.subscribe(listener);
}

export function backendStorageMode(): BackendStorageMode {
  return defaultBackend.mode;
}

/** Synchronous browser/cache read retained for existing callers and startup fallback. */
export function readLocalBackendWorkspace(): string | null {
  return defaultBackend.readCachedWorkspace();
}

/** Reads the authoritative Electron file; browser mode reads the one local envelope. */
export function readLocalBackendWorkspaceAsync(): Promise<string | null> {
  return defaultBackend.readWorkspace();
}

export function writeLocalBackendWorkspace(workspace: string): void {
  const pending = defaultBackend.writeWorkspace(workspace);
  void pending.catch(() => undefined);
}

export function recordLocalBackendAudit(service: string, action: string, metadata?: Record<string, string>): void {
  const event: BackendAuditEvent = {
    id: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    service,
    action,
    at: now(),
    metadata,
  };
  // Audit is deliberately best-effort after a successful state commit. The adapter
  // reports failures to the store without making the already-committed operation throw.
  try {
    const pending = defaultBackend.appendAudit(event);
    void pending.catch(() => undefined);
  } catch {
    // appendAudit reports synchronous browser failures through its issue listeners.
  }
}

export function readLocalBackendAudit(): BackendAuditEvent[] {
  if (typeof window === "undefined") return [];
  return defaultBackend.readCachedAudit();
}

const collectionPrefix = "gallivanting.backend.collection.";

export function readLocalBackendCollection<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(`${collectionPrefix}${key}`);
    return raw === null ? fallback : JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeLocalBackendCollection<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${collectionPrefix}${key}`, JSON.stringify(value));
}
