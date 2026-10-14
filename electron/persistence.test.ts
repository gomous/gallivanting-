import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SerializedAtomicFileStore, resolveApplicationDataFile } from "./persistence.ts";

test("application-data filenames stay inside the selected directory", () => {
  const root = join(tmpdir(), "gallivanting-boundary");
  assert.equal(resolveApplicationDataFile(root, "workspace.json"), join(root, "workspace.json"));
  assert.throws(() => resolveApplicationDataFile(root, "../outside.json"), /safe path segment/);
  assert.throws(() => resolveApplicationDataFile(root, "folder\\outside.json"), /safe path segment/);
});

test("atomic file updates serialize concurrent writers without shared temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "gallivanting-persistence-"));
  try {
    const store = new SerializedAtomicFileStore(resolveApplicationDataFile(root, "workspace.json"));
    const writes = Array.from({ length: 24 }, (_, index) => store.write(JSON.stringify({ index, payload: "x".repeat(200) })));
    await Promise.all(writes);

    const final = JSON.parse((await store.read())!);
    assert.equal(final.index, 23);
    assert.equal((await readdir(root)).some((name) => name.endsWith(".tmp")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serialized updates recover from a missing file and preserve every update", async () => {
  const root = await mkdtemp(join(tmpdir(), "gallivanting-recovery-"));
  try {
    const store = new SerializedAtomicFileStore(resolveApplicationDataFile(root, "workspace.json"));
    assert.equal(await store.read(), null);
    await Promise.all(Array.from({ length: 12 }, () => store.update((current) => {
      const value = current === null ? 0 : (JSON.parse(current) as { value: number }).value;
      return JSON.stringify({ value: value + 1 });
    })));
    assert.deepEqual(JSON.parse((await store.read())!), { value: 12 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
