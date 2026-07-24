import { Link, useLocation } from "react-router-dom";
import { IconHome, IconUsers, IconSettings, IconUser } from "../Icons";
type SidebarProps = {
  admin: boolean;
};

export function Sidebar({ admin }: SidebarProps) {
  const { pathname } = useLocation();

  const navItem = (active: boolean) =>
    `sidebar-nav-item ${active ? "active" : ""}`;

  return (
    <aside className="sidebar sticky top-0 flex h-screen w-[260px] flex-col">

      {/* Logo */}
      <div className="px-6 py-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Link to="/" className="flex items-center gap-3">
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
          <Link to="/" className={navItem(pathname === "/")}>
            <IconHome size={18} />
            <span>Dashboard</span>
          </Link>

          {admin && (
            <Link
              to="/members"
              className={navItem(pathname.startsWith("/members"))}
            >
              <IconUsers size={18} />
              <span>Members</span>
            </Link>
          )}

          {admin && (
            <Link
              to="/org-settings"
              className={navItem(pathname.startsWith("/org-settings"))}
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
        >
          <IconUser size={18} />
          <span>Profile</span>
        </Link>
      </div>
    </aside>
  );
}