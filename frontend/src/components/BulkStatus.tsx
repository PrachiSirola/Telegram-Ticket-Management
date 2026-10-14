import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { q, toast } from "../lib/toast";
import { Dropdown } from "./Dropdown";
import { ConfirmModal } from "./ConfirmModal";
import type { BulkStatusResult, TicketStatus } from "../types";

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "DONE", label: "Done" },
];
const STATUS_LABEL: Record<TicketStatus, string> = { OPEN: "Open", IN_PROGRESS: "In Progress", DONE: "Done" };

// Every list that can show a ticket's status. Prefix-matched, so the page's own filters,
// page number and page size (part of each key) are untouched — the same query just refetches.
const REFRESH_KEYS = ["tickets", "myTickets", "myWork", "memberTickets", "ticket", "activity", "projects"];

export interface BulkItem {
  id: string;
  title: string;
}

/** Selection for the tickets on the current page. Ids that leave the page (page change, filter change, refetch) are dropped. */
export function useBulkSelect(items: BulkItem[] | undefined) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Checkboxes stay hidden until the user clicks "Select".
  const [active, setActive] = useState(false);
  const ids = useMemo(() => (items ?? []).map((t) => t.id), [items]);
  const idKey = ids.join(",");

  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(ids);
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(ids));
  }, [allSelected, idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const clear = useCallback(() => setSelected(new Set()), []);
  const start = useCallback(() => setActive(true), []);
  const cancel = useCallback(() => {
    setActive(false);
    setSelected(new Set());
  }, []);

  return { selected, setSelected, toggle, toggleAll, clear, start, cancel, active, allSelected, count: selected.size, items: items ?? [] };
}
export type BulkSelect = ReturnType<typeof useBulkSelect>;

/** Checkbox for one row. Stops the click so it never follows the row's link. */
export function RowCheck({ checked, onToggle, label, disabled = false }: { checked: boolean; onToggle: () => void; label: string; disabled?: boolean }) {
  return (
    <input
      type="checkbox"
      data-testid="row-check"
      aria-label={label}
      className="h-4 w-4 shrink-0 cursor-pointer accent-[#5C4033] disabled:cursor-not-allowed disabled:opacity-40"
      checked={checked}
      disabled={disabled}
      title={disabled ? "This ticket can't be changed" : undefined}
      onClick={(e) => e.stopPropagation()}
      onChange={onToggle}
    />
  );
}

function summarise(result: BulkStatusResult, titleOf: (id: string) => string) {
  const label = STATUS_LABEL[result.status];
  const done = result.updated.length;
  const skipped = result.skipped.length;
  const failed = result.failed.length;
  const total = done + skipped + failed;
  const noun = (n: number) => `${n} ticket${n === 1 ? "" : "s"}`;

  if (failed === 0) {
    if (done === 0) {
      toast.info(`${noun(skipped)} already ${skipped === 1 ? "was" : "were"} ${label}.`);
      return;
    }
    toast.success(
      `${noun(done)} moved to ${label}.` + (skipped ? ` ${noun(skipped)} already ${skipped === 1 ? "was" : "were"} ${label}.` : ""),
    );
    return;
  }
  const lines = result.failed.slice(0, 3).map((f) => `${q(f.title ?? titleOf(f.id))}: ${f.reason}`);
  if (failed > 3) lines.push(`…and ${failed - 3} more`);
  const detail = lines.join("; ");
  if (done === 0) {
    toast.error(detail, { title: `Couldn't update ${noun(failed)}`, duration: 9000 });
  } else {
    toast.warning(detail, { title: `${done} of ${total} moved to ${label}; ${failed} failed`, duration: 9000 });
  }
}

/**
 * Select-all strip + bulk status action, shown at the top of a ticket list.
 * Select all covers the tickets on the current page. Apply sends them to the server,
 * which checks every ticket on its own (partial failures are reported, not hidden).
 * Tickets that failed stay selected so they can be retried; the rest are cleared.
 */
export function BulkStatusBar({ select, noun = "tickets" }: { select: BulkSelect; noun?: string }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<TicketStatus>("DONE");
  const [confirming, setConfirming] = useState(false);
  const { selected, items } = select;

  const mutation = useMutation({
    mutationFn: (vars: { ids: string[]; status: TicketStatus }) => api.bulkUpdateStatus(vars.ids, vars.status),
    onSuccess: (result) => {
      setConfirming(false);
      const titles = new Map(items.map((t) => [t.id, t.title]));
      summarise(result, (id) => titles.get(id) ?? "A ticket");
      select.setSelected(new Set(result.failed.map((f) => f.id)));
      for (const key of REFRESH_KEYS) qc.invalidateQueries({ queryKey: [key] });
    },
    // Request-level failure (network, 400, 401…): nothing was changed, keep the selection.
    onError: (err: any) => {
      setConfirming(false);
      toast.error(err?.response?.data?.error ?? "Couldn't update the tickets. Please try again.", { title: "Status not changed" });
    },
  });

  if (items.length === 0) return null;
  const n = select.count;

  if (!select.active) {
    return (
      <div data-testid="bulk-bar" className="flex items-center justify-end border-b border-card-border bg-accent/40 px-5 py-2">
        <button type="button" data-testid="bulk-select" className="btn btn-secondary btn-sm" onClick={select.start}>
          Select
        </button>
      </div>
    );
  }
  return (
    <div
      data-testid="bulk-bar"
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-card-border px-5 py-2.5 text-sm ${
        n > 0 ? "bg-accent" : "bg-accent/40"
      }`}
    >
      <label className="flex cursor-pointer items-center gap-3 text-xs font-medium text-fg-soft">
        <input
          type="checkbox"
          data-testid="select-all"
          aria-label={`Select all ${noun} on this page`}
          className="h-4 w-4 shrink-0 cursor-pointer accent-[#5C4033]"
          checked={select.allSelected}
          ref={(el) => {
            if (el) el.indeterminate = n > 0 && !select.allSelected;
          }}
          onChange={select.toggleAll}
        />
        Select all on this page
      </label>
      <span data-testid="bulk-count" className="text-xs font-semibold text-fg">
        {n} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {n > 0 && (
          <>
            <span className="text-xs text-muted">Move to</span>
            <Dropdown
              size="sm"
              className="w-36"
              ariaLabel="Bulk status"
              value={status}
              onChange={(v) => setStatus(v as TicketStatus)}
              options={STATUS_OPTIONS}
              disabled={mutation.isPending}
            />
            <button type="button" data-testid="bulk-apply" className="btn btn-primary btn-sm" disabled={mutation.isPending} onClick={() => setConfirming(true)}>
              {mutation.isPending ? "Updating…" : "Apply"}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={mutation.isPending} onClick={select.clear}>
              Clear
            </button>
          </>
        )}
        <button type="button" data-testid="bulk-cancel" className="btn btn-secondary btn-sm" disabled={mutation.isPending} onClick={select.cancel}>
          Cancel
        </button>
      </div>
      <ConfirmModal
        open={confirming}
        title="Update ticket status"
        variant="primary"
        confirmLabel="Update status"
        pendingLabel="Updating…"
        pending={mutation.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => mutation.mutate({ ids: [...selected], status })}
        message={
          <p data-testid="bulk-confirm">
            Move <strong>{n} {n === 1 ? "ticket" : "tickets"}</strong> to <strong>{STATUS_LABEL[status]}</strong>? Tickets you can't change are skipped and reported afterwards.
          </p>
        }
      />
    </div>
  );
}