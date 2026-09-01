import { Link, useLocation } from "react-router-dom";
import { IconHome, IconUsers, IconSettings, IconUser, IconTicket, IconX } from "../Icons";

type SidebarProps = {
  admin: boolean;
  developer: boolean;
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ admin, developer, open, onClose }: SidebarProps) {
  const { pathname } = useLocation();

  const navItem = (active: boolean) =>
    `sidebar-nav-item ${active ? "active" : ""}`;

  return (
    <>
      {/* Mobile-only backdrop — tap to close. Never rendered at lg+, where
          the sidebar is permanently visible and there's nothing to dim. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`sidebar fixed inset-y-0 left-0 z-50 flex h-screen w-[260px] flex-col transition-transform duration-300 ease-in-out lg:sticky lg:top-0 lg:z-30 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <Link to="/" className="flex items-center gap-3" onClick={onClose}>
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold text-white"
              style={{ background: 'var(--gradient-brand)' }}
            >
              T
            </div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight text-white">
                Tickets
              </h1>
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Ticket Management
              </p>
            </div>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-4 py-6">
          <div
            className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            Workspace
          </div>

          <div className="space-y-1">
            <Link to="/" className={navItem(pathname === "/")} onClick={onClose}>
              <IconHome size={18} />
              <span>Dashboard</span>
            </Link>

            {developer && (
              <Link
                to="/my-work"
                className={navItem(pathname.startsWith("/my-work"))}
                onClick={onClose}
              >
                <IconTicket size={18} />
                <span>My Work</span>
              </Link>
            )}

            {admin && (
              <Link
                to="/members"
                className={navItem(pathname.startsWith("/members"))}
                onClick={onClose}
              >
                <IconUsers size={18} />
                <span>Members</span>
              </Link>
            )}

            {admin && (
              <Link
                to="/org-settings"
                className={navItem(pathname.startsWith("/org-settings"))}
                onClick={onClose}
              >
                <IconSettings size={18} />
                <span>Organization</span>
              </Link>
            )}
          </div>
        </nav>

        {/* Footer */}
        <div className="p-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <Link
            to="/profile"
            className={navItem(pathname.startsWith("/profile"))}
            onClick={onClose}
          >
            <IconUser size={18} />
            <span>Profile</span>
          </Link>
        </div>
      </aside>
    </>
  );
}