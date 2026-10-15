import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "./Modal";

export type ConfirmField = {
  /** Shown above the input, e.g. "Type the ticket name to confirm". */
  label: string;
  /** The exact text that must be typed (compared after trimming, case-sensitive). */
  expected: string;
  testId?: string;
};

/**
 * Same design and behaviour as the Delete Project dialog: a description (optionally with a list of
 * what will be affected), one or more "type the exact name" fields, and Cancel / confirm buttons.
 * The confirm button stays disabled until every field matches exactly.
 */
export function TypeToConfirmModal({
  open,
  title,
  children,
  fields,
  confirmLabel,
  pendingLabel,
  variant = "danger",
  pending = false,
  loading = false,
  error,
  onConfirm,
  onClose,
  testId = "confirm",
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  fields: ConfirmField[];
  confirmLabel: string;
  pendingLabel?: string;
  /** "danger" (red) for deletions / lock-outs, "primary" for restorable actions like archive. */
  variant?: "danger" | "primary";
  pending?: boolean;
  /** True while the impact list is still loading — keeps the confirm button disabled. */
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  /** Prefix for data-testid: `${testId}-field-0`, `${testId}-submit`. */
  testId?: string;
}) {
  const [typed, setTyped] = useState<string[]>([]);
  useEffect(() => {
    if (open) setTyped(fields.map(() => ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const matches = fields.every((f, i) => (typed[i] ?? "").trim() === f.expected.trim());
  const canSubmit = open && matches && !pending && !loading;

  return (
    <Modal open={open} onClose={pending ? () => {} : onClose} title={title} width={460}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onConfirm();
        }}
      >
        <div className="text-sm text-fg-soft">
          {children}
          {fields.map((f, i) => (
            <div key={f.label}>
              <div className="eyebrow mb-1.5 mt-4">{f.label}</div>
              <input
                className="input"
                value={typed[i] ?? ""}
                placeholder={f.expected}
                onChange={(e) => setTyped((t) => t.map((v, j) => (j === i ? e.target.value : v)))}
                autoFocus={i === 0}
                autoComplete="off"
                data-testid={f.testId ?? `${testId}-field-${i}`}
              />
            </div>
          ))}
          {error && (
            <div className="alert alert-danger mt-3 text-sm" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="submit"
            className={`btn btn-sm ${variant === "danger" ? "btn-danger" : "btn-primary"}`}
            disabled={!canSubmit}
            data-testid={`${testId}-submit`}
          >
            {pending ? pendingLabel ?? `${confirmLabel}…` : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
