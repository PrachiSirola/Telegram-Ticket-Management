import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { q, toast } from "../lib/toast";
import { Modal } from "./Modal";
import type { BulkProjectAction, BulkProjectsResult } from "../types";
import type { BulkSelect } from "./BulkStatus";

const TICKET_KEYS = ["tickets", "myTickets", "myWork", "memberTickets", "ticket", "activity"];

const COPY: Record<BulkProjectAction, { verb: string; done: string; title: string; button: string; strong: boolean }> = {
  archive: { verb: "Archive", done: "archived", title: "Archive projects", button: "Archive projects", strong: true },
  close: { verb: "Close", done: "closed", title: "Close projects", button: "Close projects", strong: true },
  restore: { verb: "Restore", done: "restored", title: "Restore projects", button: "Restore projects", strong: false },
};

function summarise(result: BulkProjectsResult, nameOf: (id: string) => string) {
  const { action } = result;
  const word = COPY[action].done;
  const done = result.updated.length;
  const failed = result.failed.length;
  const skipped = result.skipped.length;
  const noun = (n: number) => `${n} project${n === 1 ? "" : "s"}`;
  const tickets = result.updated.reduce((n, p) => n + (p.tickets ?? 0), 0);
  const base =
    action === "close"
      ? `${noun(done)} ${word} — ${tickets} open ticket${tickets === 1 ? "" : "s"} marked Done.`
      : `${noun(done)} ${word}.`;
  const skipNote = skipped ? ` ${noun(skipped)} skipped (${[...new Set(result.skipped.map((s) => s.reason.toLowerCase()))].join(", ")}).` : "";

  if (failed === 0) {
    if (done === 0) toast.info(`Nothing to do — ${noun(skipped)} skipped (${[...new Set(result.skipped.map((s) => s.reason.toLowerCase()))].join(", ")}).`);
    else toast.success(base + skipNote);
    return;
  }
  const lines = result.failed.slice(0, 3).map((f) => `${q(f.name ?? nameOf(f.id))}: ${f.reason}`);
  if (failed > 3) lines.push(`…and ${failed - 3} more`);
  if (done === 0) toast.error(lines.join("; "), { title: `Couldn't ${action} ${noun(failed)}`, duration: 9000 });
  else toast.warning(lines.join("; "), { title: `${done} of ${done + failed} ${word}; ${failed} failed`, duration: 9000 });
}

/**
 * Toolbar + confirmation for bulk project actions (Admin / Super Admin only — the caller only
 * renders it for them, and the server enforces it again). Archived tab → Restore; live tabs →
 * Close and Archive. Close / Archive need an explicit "I understand" tick.
 */
export function BulkProjectsBar({ select, orgId, archivedTab }: { select: BulkSelect; orgId: string; archivedTab: boolean }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<BulkProjectAction | null>(null);
  const [ack, setAck] = useState(false);
  const n = select.count;

  const mutation = useMutation({
    mutationFn: (vars: { ids: string[]; action: BulkProjectAction }) => api.bulkProjects(orgId, vars.ids, vars.action),
    onSuccess: (result) => {
      setPending(null);
      const names = new Map(select.items.map((p) => [p.id, p.title]));
      summarise(result, (id) => names.get(id) ?? "A project");
      select.setSelected(new Set(result.failed.map((f) => f.id)));
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (result.action === "close") for (const key of TICKET_KEYS) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (err: any) => {
      setPending(null);
      toast.error(err?.response?.data?.error ?? "Couldn't update the projects. Please try again.", { title: "Projects not changed" });
    },
  });

  function ask(action: BulkProjectAction) {
    setAck(false);
    setPending(action);
  }
  const copy = pending ? COPY[pending] : null;
  const names = select.items.filter((p) => select.selected.has(p.id)).map((p) => p.title);

  return (
    <div
      data-testid="bulk-bar"
      className={`mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-card-border px-4 py-2.5 text-sm ${n > 0 ? "bg-accent" : "bg-accent/40"}`}
    >
      <label className="flex cursor-pointer items-center gap-3 text-xs font-medium text-fg-soft">
        <input
          type="checkbox"
          data-testid="select-all"
          aria-label="Select all projects on this page"
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
            {archivedTab ? (
              <button type="button" data-testid="bulk-restore" className="btn btn-primary btn-sm" disabled={mutation.isPending} onClick={() => ask("restore")}>
                Restore
              </button>
            ) : (
              <>
                <button type="button" data-testid="bulk-close" className="btn btn-secondary btn-sm" disabled={mutation.isPending} onClick={() => ask("close")}>
                  Close
                </button>
                <button type="button" data-testid="bulk-archive" className="btn btn-primary btn-sm" disabled={mutation.isPending} onClick={() => ask("archive")}>
                  Archive
                </button>
              </>
            )}
            <button type="button" className="btn btn-secondary btn-sm" disabled={mutation.isPending} onClick={select.clear}>
              Clear
            </button>
          </>
        )}
        <button type="button" data-testid="bulk-cancel" className="btn btn-secondary btn-sm" disabled={mutation.isPending} onClick={select.cancel}>
          Cancel
        </button>
      </div>

      <Modal open={!!pending} onClose={() => !mutation.isPending && setPending(null)} title={copy?.title ?? ""}>
        {pending && copy && (
          <div data-testid="bulk-confirm" className="text-sm text-fg-soft">
            <p>
              {copy.verb} <strong>{n} {n === 1 ? "project" : "projects"}</strong>?
            </p>
            <ul className="mt-2 max-h-28 list-disc overflow-auto pl-5 text-xs text-muted">
              {names.slice(0, 8).map((nm, i) => <li key={i}>{nm}</li>)}
              {names.length > 8 && <li>…and {names.length - 8} more</li>}
            </ul>
            {pending === "archive" && (
              <p className="mt-3">Archived projects leave the default lists and become read-only until restored. Nothing is deleted — tickets, members and clients stay as they are.</p>
            )}
            {pending === "close" && (
              <p className="mt-3">
                This marks <strong>every open and in-progress ticket</strong> in {n === 1 ? "this project" : "these projects"} as <strong>Done</strong>, which is what makes a project Closed. Archived projects are skipped. Reopen tickets individually to undo it.
              </p>
            )}
            {pending === "restore" && <p className="mt-3">They return to the project lists and can be edited again.</p>}
            {copy.strong && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-fg">
                <input type="checkbox" data-testid="bulk-ack" className="mt-0.5 h-4 w-4 accent-[#5C4033]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                I understand and want to {copy.verb.toLowerCase()} {n === 1 ? "this project" : "these projects"}.
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-secondary btn-sm" disabled={mutation.isPending} onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                data-testid="bulk-confirm-btn"
                className={`btn btn-sm ${copy.strong ? "btn-danger" : "btn-primary"}`}
                disabled={mutation.isPending || (copy.strong && !ack)}
                onClick={() => mutation.mutate({ ids: [...select.selected], action: pending })}
              >
                {mutation.isPending ? `${copy.verb}…` : copy.button}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}