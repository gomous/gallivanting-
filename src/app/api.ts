/** Thin client for the Gallivanter Worker API. Every CRM action goes through `tool()`. */
import type { ModuleKey, Values } from "../crm/model";

export type Role = "owner" | "admin" | "member" | "viewer";

export interface User { id: string; email: string; name: string; picture: string }
export interface Workspace {
  id: string; name: string; personal: number; sheetId: string; role: Role;
  lastSyncedAt: string | null; syncStatus: string | null; syncError: string | null;
}
export interface Me { user: User; workspaces: Workspace[]; googleConnected: boolean }

export interface Rec {
  id: string; module: ModuleKey; title: string; values: Values; tags: string[];
  ownerId: string | null; version: number; convertedTo: Record<string, string> | null;
  createdBy: string | null; updatedBy: string | null; createdAt: string; updatedAt: string; deletedAt: string | null;
}
export interface Rule { field: string; operator: string; value?: string }
export interface Member { id: string; name: string; email: string; picture: string; role: Role; isYou: boolean }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details);
  return data as T;
}

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  createWorkspace: (name: string, personal = false) => request<{ id: string }>("POST", "/api/workspaces", { name, personal }),
  renameWorkspace: (id: string, name: string) => request("PATCH", `/api/workspaces/${id}`, { name }),
  deleteWorkspace: (id: string) => request("DELETE", `/api/workspaces/${id}`),
  acceptInvite: (token: string) => request<{ workspaceId: string; role: Role }>("POST", `/api/invites/${token}/accept`),
  syncSheet: (ws: string) => request<{ synced: { ok: boolean; error?: string }[] }>("POST", `/api/w/${ws}/sync-sheet`),
  logout: () => request("POST", "/api/auth/logout"),
  login: (next = "/app") => { window.location.href = `/api/auth/google?next=${encodeURIComponent(next)}`; },
  async tool<T = unknown>(ws: string, name: string, input: unknown = {}): Promise<T> {
    const out = await request<{ result: T }>("POST", `/api/w/${ws}/tools/${name}`, input);
    return out.result;
  },
};

/** Tiny pub/sub so any screen can say "data changed" and lists refresh. */
type Listener = () => void;
const listeners = new Set<Listener>();
export const changes = {
  emit: () => listeners.forEach((l) => l()),
  subscribe: (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; },
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const errs = (e.details as { errors?: string[] } | undefined)?.errors;
    return errs?.length ? errs.join(" ") : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
export const fmtMoney = (n: number | string | undefined) => {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(n);
};
