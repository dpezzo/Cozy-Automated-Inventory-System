import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { defaultUploadDir } from "../config/paths";

function storageRoot(): string {
  return defaultUploadDir();
}

export function computeChecksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export interface SavedFile {
  storagePath: string;
  checksum: string;
  sizeBytes: number;
}

/**
 * Persists an uploaded file under a random, non-predictable name outside any
 * public/static directory. Files are only ever served back through an
 * authenticated download route, never a direct static URL.
 */
export function saveUploadedFile(buffer: Buffer, kind: string, extension: string): SavedFile {
  const root = storageRoot();
  const subdir = path.join(root, kind);
  mkdirSync(subdir, { recursive: true });
  const filename = `${randomUUID()}${extension}`;
  const fullPath = path.join(subdir, filename);
  writeFileSync(fullPath, buffer);
  return {
    storagePath: path.relative(root, fullPath),
    checksum: computeChecksum(buffer),
    sizeBytes: buffer.length,
  };
}

export function saveGeneratedFile(content: string, kind: string, filename: string): SavedFile {
  const root = storageRoot();
  const subdir = path.join(root, kind);
  mkdirSync(subdir, { recursive: true });
  const fullPath = path.join(subdir, filename);
  const buffer = Buffer.from(content, "utf8");
  writeFileSync(fullPath, buffer);
  return {
    storagePath: path.relative(root, fullPath),
    checksum: computeChecksum(buffer),
    sizeBytes: buffer.length,
  };
}

export function readStoredFile(storagePath: string): Buffer {
  return readFileSync(path.join(storageRoot(), storagePath));
}

export function readStoredFileText(storagePath: string): string {
  return readStoredFile(storagePath).toString("utf8");
}

/** Best-effort delete -- the DB row is the source of truth, so a file already missing on disk (or a permissions hiccup) is not fatal to the caller's cleanup. */
export function deleteStoredFile(storagePath: string): void {
  try {
    unlinkSync(path.join(storageRoot(), storagePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
