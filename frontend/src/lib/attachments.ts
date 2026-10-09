import { api } from "./api";
export const ALLOWED_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "pdf",
  "txt", "log", "md", "csv", "json",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip",
] as const;
export const ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");
export const MAX_FILE_MB = 10;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 10;
export const ALLOWED_SUMMARY = "Images, PDF, Office, text, zip";

export function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};
export const isImageMime = (mime: string) => mime.startsWith("image/");

export interface RejectedFile {
  name: string;
  reason: string;
}
export function validateFiles(
  files: File[],
  alreadyStaged: File[] = [],
  max = MAX_FILES_PER_UPLOAD,
): { accepted: File[]; rejected: RejectedFile[] } {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  const seen = new Set(alreadyStaged.map((f) => `${f.name}:${f.size}`));
  for (const f of files) {
    const ext = extOf(f.name);
    if (!ext) rejected.push({ name: f.name, reason: "has no file extension" });
    else if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext))
      rejected.push({ name: f.name, reason: `.${ext} files aren't allowed (${ALLOWED_SUMMARY})` });
    else if (f.size === 0) rejected.push({ name: f.name, reason: "is empty" });
    else if (f.size > MAX_FILE_BYTES)
      rejected.push({ name: f.name, reason: `is too large (${humanSize(f.size)}, max ${MAX_FILE_MB} MB)` });
    else if (seen.has(`${f.name}:${f.size}`)) rejected.push({ name: f.name, reason: "was already added" });
    else if (alreadyStaged.length + accepted.length >= max)
      rejected.push({ name: f.name, reason: `exceeds the limit of ${max} files per upload` });
    else {
      seen.add(`${f.name}:${f.size}`);
      accepted.push(f);
    }
  }
  return { accepted, rejected };
}
export function uploadErrorMessage(e: any): { message: string; files?: RejectedFile[] } {
  const data = e?.response?.data;
  if (e?.response?.status === 413) return { message: data?.error ?? `A file is too large (max ${MAX_FILE_MB} MB).` };
  if (data?.files?.length) {
    return {
      message: data.error ?? "Some files were rejected.",
      files: data.files.map((f: any) => ({ name: f.filename, reason: f.error })),
    };
  }
  if (data?.error) return { message: typeof data.error === "string" ? data.error : "Upload failed." };
  if (e?.code === "ERR_NETWORK") return { message: "Network error — check your connection and try again." };
  return { message: "Upload failed. Please try again." };
}
const urlCache = new Map<string, Promise<string>>();

export function getBlobUrl(id: string, mode: "preview" | "download" = "preview"): Promise<string> {
  const key = `${mode}:${id}`;
  let p = urlCache.get(key);
  if (!p) {
    p = api.attachmentBlob(id, mode).then((b) => URL.createObjectURL(b));
    p.catch(() => urlCache.delete(key)); // let a later attempt retry
    urlCache.set(key, p);
  }
  return p;
}
export function dropBlobUrl(id: string) {
  for (const mode of ["preview", "download"] as const) {
    const p = urlCache.get(`${mode}:${id}`);
    if (p) p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    urlCache.delete(`${mode}:${id}`);
  }
}

export async function downloadAttachment(att: { id: string; filename: string }) {
  const blob = await api.attachmentBlob(att.id, "download");
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = att.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}