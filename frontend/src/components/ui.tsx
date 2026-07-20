import { useState } from "react";
import type { TicketPriority, TicketStatus, TicketType } from "../types";

const STATUS: Record<TicketStatus, string> = {
  OPEN: "b-neutral",
  IN_PROGRESS: "b-warn",
  DONE: "b-ok",
};
const STATUS_DOT: Record<TicketStatus, string> = {
  OPEN: "var(--muted)",
  IN_PROGRESS: "var(--warn)",
  DONE: "var(--ok)",
};
const PRIORITY: Record<TicketPriority, string> = {
  LOW: "b-outline-muted",
  MEDIUM: "b-sage",
  HIGH: "b-warn",
  URGENT: "b-danger",
};
const TYPE: Record<TicketType, string> = {
  BUG: "b-outline-danger",
  FEATURE: "b-outline-ok",
  TASK: "b-outline-muted",
};

export const StatusBadge = ({ status }: { status: TicketStatus }) => (
  <span className={`badge ${STATUS[status]}`}>
    <span className="dot" style={{ background: STATUS_DOT[status] }} />
    {status.replace("_", " ")}
  </span>
);
export const PriorityBadge = ({ priority }: { priority: TicketPriority }) => (
  <span className={`badge ${PRIORITY[priority]}`}>{priority}</span>
);
export const TypeBadge = ({ type }: { type: TicketType }) => (
  <span className={`badge ${TYPE[type]}`}>{type}</span>
);

export function Avatar({ name, url, size = 28 }: { name: string; url?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials =
    name
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name}
        title={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="avatar object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      title={name}
    >
      {initials}
    </span>
  );
}
