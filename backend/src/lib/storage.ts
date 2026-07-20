import { mkdir, rm, unlink } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { env } from "../env.js";

const root = path.resolve(process.cwd(), env.uploadDir);

/** Persist a buffer under uploads/<ticketId>/<key> and return the relative key. */
export async function saveFile(ticketId: string, key: string, buffer: Buffer) {
  const dir = path.join(root, ticketId);
  await mkdir(dir, { recursive: true });
  const abs = path.join(dir, key);
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(abs);
    ws.on("error", reject);
    ws.on("finish", () => resolve());
    ws.end(buffer);
  });
  return path.posix.join(ticketId, key); // stored as storageKey
}

/** Absolute path for a stored key, guarded against path traversal. */
export function resolveStoredPath(storageKey: string): string | null {
  const abs = path.resolve(root, storageKey);
  if (!abs.startsWith(root + path.sep)) return null; // traversal guard
  if (!existsSync(abs)) return null;
  return abs;
}

export async function deleteFile(storageKey: string) {
  const abs = resolveStoredPath(storageKey);
  if (abs) await unlink(abs).catch(() => {});
}

/** Remove a ticket's whole upload directory (used when the ticket is deleted). */
export async function deleteTicketFiles(ticketId: string) {
  const abs = path.resolve(root, ticketId);
  if (!abs.startsWith(root + path.sep)) return; // traversal guard
  await rm(abs, { recursive: true, force: true }).catch(() => {});
}
