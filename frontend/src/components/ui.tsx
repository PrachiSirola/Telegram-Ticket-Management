import { useState } from "react";
import type {
  TicketPriority,
  TicketStatus,
  TicketType,
} from "../types";

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

function label(text: string) {
  return text
    .toLowerCase()
    .replace("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({
  status,
}: {
  status: TicketStatus;
}) {
  return (
    <span className={`badge ${STATUS[status]}`}>
      <span
        className="dot"
        style={{
          background: STATUS_DOT[status],
        }}
      />
      {label(status)}
    </span>
  );
}

export function PriorityBadge({
  priority,
}: {
  priority: TicketPriority;
}) {
  return (
    <span className={`badge ${PRIORITY[priority]}`}>
      {label(priority)}
    </span>
  );
}

export function TypeBadge({
  type,
}: {
  type: TicketType;
}) {
  return (
    <span className={`badge ${TYPE[type]}`}>
      {label(type)}
    </span>
  );
}

export function Avatar({
  name,
  url,
  size = 30,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
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
        style={{
          width: size,
          height: size,
        }}
      />
    );
  }

  return (
    <span
      className="avatar select-none"
      title={name}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        fontWeight: 600,
      }}
    >
      {initials}
    </span>
  );
}