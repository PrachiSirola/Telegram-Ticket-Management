import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Dropdown } from "./Dropdown";
import { IconUpload } from "./Icons";
import type { Attachment, CommentVisibility } from "../types";

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Attachments({
  ticketId,
  canPostInternal,
}: {
  ticketId: string;
  canPostInternal: boolean;
}) {
  const qc = useQueryClient();
  const { data: items } = useQuery({
    queryKey: ["attachments", ticketId],
    queryFn: () => api.attachments(ticketId),
  });

  const [visibility, setVisibility] = useState<CommentVisibility>(
    canPostInternal ? "INTERNAL" : "CLIENT_VISIBLE",
  );
  const [error, setError] = useState<string | null>(null);

  const uploadMut = useMutation({
    mutationFn: (file: File) => api.uploadAttachment(ticketId, file, visibility),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments", ticketId] }),
    onError: (e: any) => setError(e?.response?.data?.error ?? "Upload failed (size/type?)"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteAttachment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments", ticketId] }),
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setError(null);
      uploadMut.mutate(file);
    }
    e.target.value = "";
  }

  return (
    <div className="mt-8">
      <div className="eyebrow mb-3">Attachments</div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items?.map((a) => (
          <AttachmentCard key={a.id} att={a} onDelete={() => deleteMut.mutate(a.id)} />
        ))}
        {items?.length === 0 && (
          <p className="col-span-full text-sm text-muted">No attachments yet.</p>
        )}
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <label className="btn btn-primary btn-sm cursor-pointer">
          <IconUpload size={15} />
          {uploadMut.isPending ? "Uploading…" : "Upload Image"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFile}
            disabled={uploadMut.isPending}
          />
        </label>
        {canPostInternal && (
          <Dropdown
            className="w-52"
            size="sm"
            value={visibility}
            onChange={(v) => setVisibility(v as CommentVisibility)}
            options={[
              { value: "INTERNAL", label: "Internal (team only)" },
              { value: "CLIENT_VISIBLE", label: "Client-visible" },
            ]}
          />
        )}
        <span className="eyebrow">Max 10 MB · images only</span>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}

function AttachmentCard({ att, onDelete }: { att: Attachment; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const isImage = att.mimeType.startsWith("image/") && !imgFailed;

  useEffect(() => {
    let revoke: string | null = null;
    if (isImage) {
      api.attachmentBlob(att.id).then((blob) => {
        const u = URL.createObjectURL(blob);
        revoke = u;
        setUrl(u);
      });
    }
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [att.id, isImage]);

  async function download() {
    const blob = await api.attachmentBlob(att.id);
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = att.filename;
    a.click();
    URL.revokeObjectURL(u);
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex h-24 items-center justify-center bg-accent">
        {isImage && url ? (
          <img
            src={url}
            alt={att.filename}
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-3xl">📄</span>
        )}
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-medium text-fg" title={att.filename}>
          {att.filename}
        </div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted">
          {humanSize(att.size)}
          {att.visibility === "INTERNAL" && <span className="badge b-warn">Internal</span>}
        </div>
        <div className="flex gap-3 text-xs">
          <button onClick={download} className="link">Download</button>
          <button onClick={onDelete} className="link link-danger">Delete</button>
        </div>
      </div>
    </div>
  );
}