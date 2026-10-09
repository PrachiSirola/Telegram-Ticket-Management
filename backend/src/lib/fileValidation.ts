import path from "node:path";
export const MAX_FILES_PER_UPLOAD = 10;

export interface FileKind {
  mime: string;
  previewable: boolean;
  matches: (b: Buffer) => boolean;
}

const startsWith = (b: Buffer, sig: number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Buffer, s: string, offset = 0) =>
  b.length >= offset + s.length && b.subarray(offset, offset + s.length).toString("latin1") === s;

const isPng = (b: Buffer) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isJpeg = (b: Buffer) => startsWith(b, [0xff, 0xd8, 0xff]);
const isGif = (b: Buffer) => ascii(b, "GIF87a") || ascii(b, "GIF89a");
const isWebp = (b: Buffer) => ascii(b, "RIFF") && ascii(b, "WEBP", 8);
const isPdf = (b: Buffer) => b.subarray(0, 1024).includes("%PDF-");
const isZip = (b: Buffer) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]);
const isOle = (b: Buffer) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); 
const isText = (b: Buffer) => !b.subarray(0, 8192).includes(0);

const OOXML = (mime: string): FileKind => ({ mime, previewable: false, matches: isZip });

export const FILE_KINDS: Record<string, FileKind> = {
  png: { mime: "image/png", previewable: true, matches: isPng },
  jpg: { mime: "image/jpeg", previewable: true, matches: isJpeg },
  jpeg: { mime: "image/jpeg", previewable: true, matches: isJpeg },
  gif: { mime: "image/gif", previewable: true, matches: isGif },
  webp: { mime: "image/webp", previewable: true, matches: isWebp },
  pdf: { mime: "application/pdf", previewable: true, matches: isPdf },
  txt: { mime: "text/plain", previewable: false, matches: isText },
  log: { mime: "text/plain", previewable: false, matches: isText },
  md: { mime: "text/markdown", previewable: false, matches: isText },
  csv: { mime: "text/csv", previewable: false, matches: isText },
  json: { mime: "application/json", previewable: false, matches: isText },
  doc: { mime: "application/msword", previewable: false, matches: isOle },
  xls: { mime: "application/vnd.ms-excel", previewable: false, matches: isOle },
  ppt: { mime: "application/vnd.ms-powerpoint", previewable: false, matches: isOle },
  docx: OOXML("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  xlsx: OOXML("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  pptx: OOXML("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
  zip: { mime: "application/zip", previewable: false, matches: isZip },
};

export const ALLOWED_EXTENSIONS = Object.keys(FILE_KINDS);

export type FileCheck =
  | { ok: true; ext: string; mime: string; previewable: boolean; filename: string }
  | { ok: false; filename: string; error: string };
export function safeFilename(name: string): string {
  const base = (name ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim().slice(0, 255);
  return cleaned || "file";
}

export function checkUpload(originalName: string, buffer: Buffer, maxBytes: number): FileCheck {
  const filename = safeFilename(originalName);
  const ext = path.extname(filename).slice(1).toLowerCase();
  const fail = (error: string): FileCheck => ({ ok: false, filename, error });

  if (buffer.length === 0) return fail("File is empty.");
  if (buffer.length > maxBytes) {
    return fail(`File is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`);
  }
  if (!ext) return fail("File has no extension, so its type can't be verified.");
  const kind = FILE_KINDS[ext];
  if (!kind) {
    return fail(`.${ext} files aren't allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`);
  }
  if (!kind.matches(buffer)) {
    return fail(`The file's contents don't match its .${ext} extension.`);
  }
  return { ok: true, ext, mime: kind.mime, previewable: kind.previewable, filename };
}
export function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}