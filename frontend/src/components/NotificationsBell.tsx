import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: api.notifications,
    refetchInterval: 15000,
  });

  const unread = data?.unread ?? 0;

  // Close on outside click / Escape. Capture phase so an ancestor that stops
  // propagation can't swallow the outside-click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openTicket(id: string, notifId: string) {
    await api.markRead(notifId);
    qc.invalidateQueries({ queryKey: ["notifications"] });
    setOpen(false);
    navigate(`/tickets/${id}`);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center border border-card-border bg-bg hover:bg-accent"
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center px-1 text-[10px] font-bold text-bg"
            style={{ background: "var(--danger)" }}
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 card">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="eyebrow">Notifications</span>
            <button
              className="link text-xs"
              onClick={async () => {
                await api.markAllRead();
                qc.invalidateQueries({ queryKey: ["notifications"] });
              }}
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-auto divide-line">
            {(data?.notifications ?? []).length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted">Nothing yet</div>
            )}
            {data?.notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => openTicket(n.ticketId, n.id)}
                className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-accent ${
                  n.isRead ? "text-muted" : "font-medium text-fg"
                }`}
              >
                {n.payload?.message ?? n.type}
                <div className="mt-0.5 text-[11px] text-muted">
                  {n.ticket?.orgName && <>{n.ticket.orgName} · </>}
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
