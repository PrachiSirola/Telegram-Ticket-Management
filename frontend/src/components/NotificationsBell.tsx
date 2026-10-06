import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { IconBell } from "./Icons";

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
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-card-border bg-white text-fg-soft transition-all hover:border-primary/30 hover:text-primary hover:shadow-sm"
        title="Notifications"
      >
        <IconBell size={18} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: 'var(--danger)' }}
          >
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-2xl border border-card-border bg-white shadow-dropdown">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold text-fg">Notifications</span>
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
              <div className="px-4 py-8 text-center text-sm text-muted">Nothing yet</div>
            )}
            {data?.notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => openTicket(n.ticketId, n.id)}
                className={`block w-full px-4 py-3 text-left text-sm transition-colors hover:bg-accent ${
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