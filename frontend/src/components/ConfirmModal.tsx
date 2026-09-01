import type { ReactNode } from "react";
import { Modal } from "./Modal";

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Delete",
  pendingLabel,
  variant = "danger",
  pending = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** Text shown on the confirm button while pending. Defaults to
   * "Deleting…" for the danger variant (unchanged behaviour for existing
   * delete-confirmation call sites) and to `${confirmLabel}…` otherwise. */
  pendingLabel?: string;
  /** "danger" (default, red button — for destructive actions like delete)
   * or "primary" (for non-destructive confirmations like closing a ticket). */
  variant?: "danger" | "primary";
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const resolvedPendingLabel = pendingLabel ?? (variant === "danger" ? "Deleting…" : `${confirmLabel}…`);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-sm text-fg-soft">{message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button
          className={`btn btn-sm ${variant === "danger" ? "btn-danger" : "btn-primary"}`}
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? resolvedPendingLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}