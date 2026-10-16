import { Link } from "react-router-dom";
import type { Ticket } from "../types";
import {
  PriorityBadge,
  StatusBadge,
  TypeBadge,
} from "./ui";
import { IconArrowRight } from "./Icons";
import { AssigneeAvatars } from "./Assignees";
import { RowCheck } from "./BulkStatus";

export function TicketRow({
  ticket,
  showProject,
  linkState,
  select,
}: {
  ticket: Ticket;
  showProject?: boolean;
  linkState?: unknown;
  select?: { checked: boolean; onToggle: () => void; disabled?: boolean };
}) {
  const link = (
    <Link
      to={`/tickets/${ticket.id}`}
      state={linkState}
      className={`
        group
        flex
        items-center
        justify-between
        gap-5
        ${select ? "flex-1 min-w-0" : "border-b border-card-border/60"}
        px-5
        py-4
        transition-all
        duration-200
        hover:bg-accent
      `}
    >
      <div className="min-w-0 flex-1">

        <div className="flex items-center gap-3">
          <h3 className="truncate text-[14px] font-semibold text-fg transition-colors group-hover:text-primary">
            {ticket.title}
          </h3>

          {ticket.archivedAt && <span className="badge b-outline-muted">Archived</span>}

          {showProject && ticket.project && (
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-primary">
              {ticket.project.name}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <TypeBadge type={ticket.type} />
          {ticket.dueDate && (
            <span className="rounded-full border border-card-border px-2.5 py-0.5 text-[11px] text-muted">
              Due {new Date(ticket.dueDate).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {ticket.assignees?.length ? (
          <AssigneeAvatars assignees={ticket.assignees} names />
        ) : (
          <span className="rounded-full border border-dashed border-card-border px-3 py-1 text-xs text-muted">
            Unassigned
          </span>
        )}

        <IconArrowRight
          size={16}
          className="text-muted opacity-0 transition-all group-hover:opacity-100 group-hover:text-primary"
        />
      </div>
    </Link>
  );
  if (!select) return link;
  return (
    <div
      className={`flex items-stretch border-b border-card-border/60 ${select.checked ? "bg-accent/70" : ""}`}
      data-testid="ticket-row"
    >
      <div className="flex items-center pl-5">
        <RowCheck checked={select.checked} onToggle={select.onToggle} label={`Select ${ticket.title}`} disabled={select.disabled} />
      </div>
      {link}
    </div>
  );
}