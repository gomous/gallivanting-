import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

type FileOperation<T> = () => Promise<T>;

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

/** Resolve a fixed application-data filename without allowing path traversal. */
export function resolveApplicationDataFile(directory: string, filename: string): string {
  if (!isAbsolute(directory)) throw new Error("Application data directory must be absolute.");
  if (!filename || filename !== filename.trim() || filename.includes("\\") || filename.includes("/") || filename === "." || filename === "..") {
    throw new Error("Application data filename must be a single safe path segment.");
  }
  const root = resolve(directory);
  const candidate = resolve(root, filename);
  if (candidate !== resolve(root, candidate) || dirname(candidate) !== root) throw new Error("Application data path escaped its directory.");
  return candidate;
}

/**
 * A small serialized file primitive used by the Electron main process.
 * Every update waits for the previous update and writes through a unique
 * sibling temporary file before replacing the destination.
 */
export class SerializedAtomicFileStore {
  private tail: Promise<void> = Promise.resolve();
  private readonly file: string;

  public constructor(file: string) {
    this.file = file;
    if (!isAbsolute(file)) throw new Error("Atomic file path must be absolute.");
  }

  public read(): Promise<string | null> {
    return this.enqueue(async () => {
      try {
        return await readFile(this.file, "utf8");
      } catch (error: unknown) {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      }
    });
  }

  public write(contents: string): Promise<void> {
    return this.enqueue(async () => {
      await this.atomicWrite(contents);
    });
  }

  public update(transform: (current: string | null) => string): Promise<void> {
    return this.enqueue(async () => {
      let current: string | null;
      try {
        current = await readFile(this.file, "utf8");
      } catch (error: unknown) {
        if (errorCode(error) === "ENOENT") current = null;
        else throw error;
      }
      await this.atomicWrite(transform(current));
    });
  }

  public append(contents: string): Promise<void> {
    return this.enqueue(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await appendFile(this.file, contents, "utf8");
    });
  }

  public async flush(): Promise<void> {
    await this.tail;
  }

  private enqueue<T>(operation: FileOperation<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async atomicWrite(contents: string): Promise<void> {
    const directory = dirname(this.file);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    let completed = false;
    try {
      await writeFile(temporary, contents, "utf8");
      await rename(temporary, this.file);
      completed = true;
    } finally {
      if (!completed) {
        try {
          await unlink(temporary);
        } catch (error: unknown) {
          if (errorCode(error) !== "ENOENT") throw error;
        }
      }
    }
  }
}
