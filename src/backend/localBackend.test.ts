import assert from "node:assert/strict";
import test from "node:test";
import { readLocalBackendCollection, ReliableLocalBackend, writeLocalBackendCollection } from "./localBackend.ts";
import type { BackendDesktopApi } from "./types.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  public failWrites = false;

  public get length(): number {
    return this.values.size;
  }

  public clear(): void {
    this.values.clear();
  }

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }

  public setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("storage is read-only");
    this.values.set(key, value);
  }
}

function desktop(overrides: Partial<BackendDesktopApi> = {}): BackendDesktopApi {
  return {
    mode: "electron-local-file",
    readWorkspace: async () => null,
    writeWorkspace: async () => undefined,
    appendAudit: async () => undefined,
    ...overrides,
  };
}

test("the browser adapter rejects invalid persisted envelopes instead of treating them as empty", () => {
  const storage = new MemoryStorage();
  storage.setItem("gallivanting.backend.v1", JSON.stringify({ version: 1, updatedAt: "now", workspace: "{}", audit: [{ id: "bad" }] }));
  const backend = new ReliableLocalBackend({ storage, desktop: null });

  assert.throws(() => backend.readCachedWorkspace(), /audit\[0\]\.service/);
  assert.throws(() => backend.writeWorkspace("not-json"), /valid JSON/);
});

test("the browser adapter migrates the pre-audit workspace envelope", () => {
  const storage = new MemoryStorage();
  storage.setItem("gallivanting.backend.v1", JSON.stringify({ version: 1, updatedAt: "now", workspace: "{}" }));
  const backend = new ReliableLocalBackend({ storage, desktop: null });

  assert.equal(backend.readCachedWorkspace(), "{}");
  backend.writeWorkspace('{"version":2}');
  const envelope = JSON.parse(storage.getItem("gallivanting.backend.v1")!);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.workspace, '{"version":2}');
  assert.deepEqual(envelope.audit, []);
});

test("concurrent desktop writes are serialized and retain the latest browser envelope", async () => {
  const storage = new MemoryStorage();
  const calls: string[] = [];
  const api = desktop({
    writeWorkspace: async (workspace) => {
      calls.push(`start:${workspace}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
      calls.push(`end:${workspace}`);
    },
  });
  const backend = new ReliableLocalBackend({ storage, desktop: api });

  const first = JSON.stringify({ version: 2, id: "first" });
  const second = JSON.stringify({ version: 2, id: "second" });
  await Promise.all([backend.writeWorkspace(first), backend.writeWorkspace(second)]);

  assert.deepEqual(calls, [`start:${first}`, `end:${first}`, `start:${second}`, `end:${second}`]);
  const envelope = JSON.parse(storage.getItem("gallivanting.backend.v1")!);
  assert.equal(envelope.workspace, second);
});

test("a desktop read failure is surfaced and never triggers a fallback write", async () => {
  let writes = 0;
  const backend = new ReliableLocalBackend({
    storage: new MemoryStorage(),
    desktop: desktop({
      readWorkspace: async () => {
        throw new Error("workspace file is unreadable");
      },
      writeWorkspace: async () => {
        writes += 1;
      },
    }),
  });

  await assert.rejects(backend.readWorkspace(), /workspace file is unreadable/);
  assert.equal(writes, 0);
});

test("post-commit audit storage failures are reported without throwing from appendAudit", async () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  const issues: string[] = [];
  const backend = new ReliableLocalBackend({ storage, desktop: null });
  backend.subscribe((issue) => issues.push(`${issue.operation}: ${issue.error.message}`));

  await backend.appendAudit({ id: "audit-1", service: "workspace", action: "commit", at: "2026-10-12T10:00:00.000Z" });
  assert.deepEqual(issues, ["audit append: storage is read-only"]);
});

test("browser collections provide a local backend boundary for legacy UI surfaces", () => {
  const previousWindow = globalThis.window;
  const storage = new MemoryStorage();
  Object.assign(globalThis, { window: { localStorage: storage } });
  try {
    writeLocalBackendCollection("leads", [{ id: "lead-1" }]);
    assert.deepEqual(readLocalBackendCollection("leads", []), [{ id: "lead-1" }]);
  } finally {
    Object.assign(globalThis, { window: previousWindow });
  }
});
