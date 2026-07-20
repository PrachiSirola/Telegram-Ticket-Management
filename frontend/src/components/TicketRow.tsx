import { Link } from "react-router-dom";
import type { Ticket } from "../types";
import { Avatar, PriorityBadge, StatusBadge, TypeBadge } from "./ui";

export function TicketRow({ ticket, showProject }: { ticket: Ticket; showProject?: boolean }) {
  return (
    <Link
      to={`/tickets/${ticket.id}`}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-accent"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-fg">{ticket.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <TypeBadge type={ticket.type} />
          {showProject && ticket.project && (
            <span className="eyebrow ml-1">{ticket.project.name}</span>
          )}
          {ticket.dueDate && (
            <span className="ml-1 text-xs text-muted">
              due {new Date(ticket.dueDate).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      {ticket.assignee ? (
        <Avatar name={ticket.assignee.name} url={ticket.assignee.avatarUrl} />
      ) : (
        <span className="eyebrow">Unassigned</span>
      )}
    </Link>
  );
}
