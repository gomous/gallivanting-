export type BackendStorageMode = "browser-local" | "electron-local-file";

export type BackendDesktopApi = {
  mode: BackendStorageMode;
  readWorkspace: () => Promise<string | null>;
  writeWorkspace: (workspace: string) => Promise<void>;
  appendAudit: (event: BackendAuditEvent) => Promise<void>;
};

export type BackendAuditEvent = {
  id: string;
  service: string;
  action: string;
  at: string;
  metadata?: Record<string, string>;
};

export type BackendWorkspaceEnvelope = {
  version: 1;
  updatedAt: string;
  workspace: string;
  audit: BackendAuditEvent[];
};

type PlainObject = Record<string, unknown>;

const envelopeKeys = new Set(["version", "updatedAt", "workspace", "audit"]);
const auditKeys = new Set(["id", "service", "action", "at", "metadata"]);
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKnownKeys(value: PlainObject, keys: Set<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (unsafeKeys.has(key)) throw new Error(`${path}.${key}: unsafe property name.`);
    if (!keys.has(key)) throw new Error(`${path}.${key}: unknown property.`);
  }
}

function requiredText(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new Error(`${path}: expected a non-empty string.`);
  }
  return value;
}

export function parseBackendAuditEvent(value: unknown, path = "audit event"): BackendAuditEvent {
  if (!isPlainObject(value)) throw new Error(`${path}: expected an object.`);
  assertKnownKeys(value, auditKeys, path);
  const event: BackendAuditEvent = {
    id: requiredText(value.id, `${path}.id`),
    service: requiredText(value.service, `${path}.service`),
    action: requiredText(value.action, `${path}.action`),
    at: requiredText(value.at, `${path}.at`),
  };

  if (value.metadata !== undefined) {
    if (!isPlainObject(value.metadata)) throw new Error(`${path}.metadata: expected an object.`);
    const metadata: Record<string, string> = {};
    for (const [key, item] of Object.entries(value.metadata)) {
      if (unsafeKeys.has(key)) throw new Error(`${path}.metadata.${key}: unsafe property name.`);
      metadata[key] = requiredText(item, `${path}.metadata.${key}`, true);
    }
    event.metadata = metadata;
  }

  return event;
}

export function parseBackendWorkspaceEnvelope(value: unknown): BackendWorkspaceEnvelope {
  if (!isPlainObject(value)) throw new Error("Backend workspace file must contain an object.");
  assertKnownKeys(value, envelopeKeys, "backend workspace");
  if (value.version !== 1) throw new Error("Backend workspace file has an unsupported version.");
  const audit = value.audit;
  if (!Array.isArray(audit)) throw new Error("backend workspace.audit: expected an array.");
  return {
    version: 1,
    updatedAt: requiredText(value.updatedAt, "backend workspace.updatedAt"),
    workspace: requiredText(value.workspace, "backend workspace.workspace", true),
    audit: audit.map((event, index) => parseBackendAuditEvent(event, `backend workspace.audit[${index}]`)),
  };
}

export function parseBackendWorkspaceText(raw: string): BackendWorkspaceEnvelope {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error("Backend workspace file is empty.");
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    throw new Error(`Backend workspace file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseBackendWorkspaceEnvelope(value);
}

/**
 * Read the envelope written before the local audit log was introduced. This
 * compatibility path is deliberately narrow: only the exact version-1 shape
 * without an audit property is migrated, and the strict parser still validates
 * the resulting envelope.
 */
export function parseBackendWorkspaceEnvelopeWithMigration(value: unknown): BackendWorkspaceEnvelope {
  if (isPlainObject(value) && value.version === 1 && value.audit === undefined && Object.keys(value).every((key) => ["version", "updatedAt", "workspace"].includes(key))) {
    return parseBackendWorkspaceEnvelope({ ...value, audit: [] });
  }
  return parseBackendWorkspaceEnvelope(value);
}

export function parseBackendWorkspaceTextWithMigration(raw: string): BackendWorkspaceEnvelope {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error("Backend workspace file is empty.");
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    throw new Error(`Backend workspace file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseBackendWorkspaceEnvelopeWithMigration(value);
}

/** Validate the serialized CRM payload before it crosses the Electron IPC boundary. */
export function assertBackendWorkspacePayload(value: unknown): string {
  const workspace = requiredText(value, "Backend workspace payload");
  if (workspace.length > 50_000_000) throw new Error("Backend workspace payload is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(workspace) as unknown;
  } catch (error: unknown) {
    throw new Error(`Backend workspace payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isPlainObject(parsed)) throw new Error("Backend workspace payload must be a JSON object.");
  return workspace;
}

export type BackendServiceStatus = "foundation" | "partial" | "planned" | "blocked";

export type BackendServiceDefinition = {
  id: string;
  name: string;
  status: BackendServiceStatus;
  localResponsibilities: string[];
  zohoResponsibilities: string[];
  dependencies: string[];
  liveEvidence: string[];
  openQuestions: string[];
};
