export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** base64-encoded 32-byte key used to encrypt Google refresh tokens */
  TOKEN_KEY: string;
  DEEPSEEK_API_KEY?: string;
}

export const nowIso = (): string => new Date().toISOString();

/** Sortable, URL-safe id: time prefix + random suffix, e.g. "rec_lx3k9a_7f2c9e1b4d". */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${time}_${hex}`;
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64decode(text: string): Uint8Array {
  const norm = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return b64url(new Uint8Array(digest));
}

async function aesKey(env: Env): Promise<CryptoKey> {
  if (!env.TOKEN_KEY) throw new Error("TOKEN_KEY secret is not configured.");
  return crypto.subtle.importKey("raw", b64decode(env.TOKEN_KEY), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), new TextEncoder().encode(plain));
  return `${b64url(iv)}.${b64url(new Uint8Array(cipher))}`;
}

export async function decrypt(env: Env, sealed: string): Promise<string> {
  const [iv, data] = sealed.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64decode(iv) }, await aesKey(env), b64decode(data));
  return new TextDecoder().decode(plain);
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Error with a stable code, returned to clients/AI as structured JSON. */
export class AppError extends Error {
  constructor(
    public code: "not_found" | "forbidden" | "invalid" | "conflict" | "unauthenticated" | "upstream",
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get status(): number {
    return { not_found: 404, forbidden: 403, invalid: 400, conflict: 409, unauthenticated: 401, upstream: 502 }[this.code];
  }
}
