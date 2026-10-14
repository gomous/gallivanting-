import assert from "node:assert/strict";
import test from "node:test";
import { loadModuleRecords, persistModuleRecords, restoreModuleRecord, saveModuleRecord } from "./moduleRecords.ts";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test("module collections preserve saved Contacts instead of replacing them with seeds", () => {
  const storage = new MemoryStorage();
  const seed = [{ id: "seed", values: { lastName: "Seed" } }];
  const saved = [{ id: "1458063000000478808", values: { lastName: "Marrier", department: "Operations" } }];
  persistModuleRecords(storage, "Contacts", saved);
  assert.deepEqual(loadModuleRecords(storage, "Contacts", seed), saved);
});

test("module save updates an existing record and appends local lifecycle metadata", () => {
  const original = { id: "contact-1", values: { lastName: "Marrier", department: "" } };
  const result = saveModuleRecord([original], { lastName: "Marrier", department: "Operations" }, original.id);
  assert.equal(result.records.length, 1);
  assert.equal(result.record.values.department, "Operations");
  assert.equal(result.record.timeline?.at(-1)?.title, "Contact updated");
  assert.equal(result.record.updatedAt !== undefined, true);
});

test("deleted module records can be restored with lifecycle metadata", () => {
  const deleted = { id: "contact-1", values: { lastName: "Marrier" }, deletedAt: "2026-10-13T10:00:00.000Z" };
  const result = restoreModuleRecord([deleted], deleted.id);
  assert.equal(result.record.deletedAt, undefined);
  assert.equal(result.record.timeline?.at(-1)?.title, "Contact restored");
  assert.equal(result.records[0].id, deleted.id);
});

test("invalid persisted module records fail closed instead of falling back to seed data", () => {
  const storage = new MemoryStorage();
  storage.setItem("gallivanting.backend.collection.module.Contacts", JSON.stringify([{ id: "duplicate", values: {} }, { id: "duplicate", values: {} }]));
  assert.throws(() => loadModuleRecords(storage, "Contacts", [{ id: "seed", values: {} }]), /invalid or duplicate/);
});
