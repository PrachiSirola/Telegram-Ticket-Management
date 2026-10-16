import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Avatar } from "./ui";
import { TablePagination } from "./TablePagination";
import {
  IconArchive,
  IconCheckCircle,
  IconClock,
  IconEdit,
  IconFile,
  IconMove,
  IconPlus,
  IconReply,
  IconUser,
  IconUserPlus,
  IconCopy,
} from "./Icons";
import { VISIBILITY_LABEL } from "./VisibilityPicker";
import type { ActivityItem } from "../types";

const pretty = (v: string | null) => (v ? v.replace(/_/g, " ").toLowerCase() : "none");
const Q = ({ children }: { children: ReactNode }) => (
  <span className="break-words font-medium text-fg">{children}</span>
);

export function describe(a: ActivityItem): { icon: ReactNode; text: ReactNode } {
  switch (a.type) {
    case "TICKET_CREATED":
      return {
        icon: <IconPlus size={13} />,
        text: a.meta && (a.meta as any).duplicatedFrom ? <>created this ticket as a copy of another ticket</> : <>created this ticket</>,
      };
    case "STATUS_CHANGED":
      return { icon: <IconCheckCircle size={13} />, text: <>changed status from <Q>{pretty(a.from)}</Q> to <Q>{pretty(a.to)}</Q></> };
    case "PRIORITY_CHANGED":
      return { icon: <IconEdit size={13} />, text: <>changed priority from <Q>{pretty(a.from)}</Q> to <Q>{pretty(a.to)}</Q></> };
    case "TYPE_CHANGED":
      return { icon: <IconEdit size={13} />, text: <>changed type from <Q>{pretty(a.from)}</Q> to <Q>{pretty(a.to)}</Q></> };
    case "TITLE_CHANGED":
      return { icon: <IconEdit size={13} />, text: <>renamed the ticket from <Q>"{a.from}"</Q> to <Q>"{a.to}"</Q></> };
    case "DESCRIPTION_CHANGED":
      return { icon: <IconEdit size={13} />, text: <>edited the description</> };
    case "DUE_DATE_CHANGED":
      return {
        icon: <IconClock size={13} />,
        text: a.to ? <>set the due date to <Q>{a.to}</Q>{a.from ? <> (was {a.from})</> : null}</> : <>removed the due date</>,
      };
    case "ASSIGNED":
      return {
        icon: <IconUser size={13} />,
        text: a.to ? (
          (a.meta as any)?.self ? (
            a.from ? <>took over this ticket from <Q>{a.from}</Q></> : <>assigned this ticket to themselves</>
          ) : a.from ? (
            <>reassigned this ticket from <Q>{a.from}</Q> to <Q>{a.to}</Q></>
          ) : (
            <>assigned this ticket to <Q>{a.to}</Q></>
          )
        ) : (
          <>{a.from ? <>unassigned <Q>{a.from}</Q> from this ticket</> : "unassigned this ticket"}</>
        ),
      };
    case "ATTACHMENT_ADDED": {
      const vis = (a.meta as any)?.visibility as keyof typeof VISIBILITY_LABEL | undefined;
      return { icon: <IconFile size={13} />, text: <>added attachment <Q>{a.to}</Q>{vis ? <> <span className="text-muted">({VISIBILITY_LABEL[vis]})</span></> : null}</> };
    }
    case "ATTACHMENT_DELETED":
      return { icon: <IconFile size={13} />, text: <>deleted attachment <Q>{a.from}</Q></> };
    case "ATTACHMENT_VISIBILITY_CHANGED":
      return {
        icon: <IconFile size={13} />,
        text: <>changed who can see <Q>{(a.meta as any)?.filename ?? "an attachment"}</Q> from <Q>{a.from}</Q> to <Q>{a.to}</Q></>,
      };
    case "COMMENT_ADDED":
      return { icon: <IconReply size={13} />, text: <>{a.field === "reply" ? "replied to a comment" : "added a comment"}</> };
    case "COMMENT_EDITED":
      return { icon: <IconEdit size={13} />, text: <>edited a comment</> };
    case "COMMENT_DELETED":
      return { icon: <IconReply size={13} />, text: <>deleted a comment</> };
    case "FOLLOWER_ADDED":
      return { icon: <IconUserPlus size={13} />, text: <>added <Q>{a.to}</Q> as a follower</> };
    case "FOLLOWER_REMOVED":
      return { icon: <IconUserPlus size={13} />, text: <>removed <Q>{a.from}</Q> as a follower</> };
    case "MOVED":
      return { icon: <IconMove size={13} />, text: <>moved this ticket from <Q>{a.from}</Q> to <Q>{a.to}</Q></> };
    case "ARCHIVED":
      return { icon: <IconArchive size={13} />, text: <>archived this ticket</> };
    case "RESTORED":
      return { icon: <IconArchive size={13} />, text: <>restored this ticket from the archive</> };
    case "DUPLICATED":
      return { icon: <IconCopy size={13} />, text: <>duplicated this ticket as <Q>"{a.to}"</Q></> };
    default:
      return { icon: <IconClock size={13} />, text: <>updated this ticket</> };
  }
}

function when(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  let rel: string;
  if (mins < 1) rel = "just now";
  else if (mins < 60) rel = `${mins}m ago`;
  else if (mins < 24 * 60) rel = `${Math.floor(mins / 60)}h ago`;
  else if (mins < 7 * 24 * 60) rel = `${Math.floor(mins / 1440)}d ago`;
  else rel = d.toLocaleDateString();
  return { rel, full: d.toLocaleString() };
}

export function ActivityTimeline({ ticketId, internal }: { ticketId: string; internal: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { data, isLoading, isError, isFetching, isPlaceholderData, refetch } = useQuery({
    queryKey: ["activity", ticketId, page, pageSize],
    queryFn: () => api.ticketActivity(ticketId, { page, pageSize }),
    placeholderData: (prev) => prev,
  });

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy data-testid="activity-loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="pulse h-10 rounded-lg bg-accent" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="alert alert-danger text-sm">
        Couldn't load the activity.{" "}
        <button className="link" onClick={() => refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (data.total === 0) return <p className="text-sm text-muted">No activity yet.</p>;

  return (
    <div data-testid="activity-timeline" className={isFetching && isPlaceholderData ? "opacity-60" : ""}>
      <ol className="relative space-y-4 border-l border-card-border pl-5">
        {data.items.map((a) => {
          const { icon, text } = describe(a);
          const t = when(a.createdAt);
          return (
            <li key={a.id} className="relative" data-testid="activity-item" data-type={a.type}>
              <span className="absolute -left-[31px] top-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border border-card-border bg-white text-muted">
                {icon}
              </span>
              <div className="flex items-start gap-2">
                <Avatar name={a.actor.name} url={a.actor.avatarUrl} size={20} />
                <div className="min-w-0 flex-1 text-sm text-fg-soft">
                  <span className="font-semibold text-fg">{a.actor.name}</span> {text}
                  {internal && a.internalOnly && <span className="badge b-warn ml-1.5 align-middle">Internal</span>}
                  <div className="mt-0.5 text-[11px] text-muted" title={t.full}>
                    {t.rel} · {t.full}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {(data.total > 10 || pageSize !== 25) && (
        <TablePagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          busy={isFetching}
          noun="events"
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}