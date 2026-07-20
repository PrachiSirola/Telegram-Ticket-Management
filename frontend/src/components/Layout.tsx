import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, useAuth } from "../auth";
import { useOrg } from "../org";
import { Avatar } from "./ui";
import { Dropdown } from "./Dropdown";
import { NotificationsBell } from "./NotificationsBell";
import type { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const { orgs, activeOrg, activeOrgId, setActiveOrg } = useOrg();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const { data: projects } = useQuery({
    queryKey: ["projects", activeOrgId],
    queryFn: () => api.projects(activeOrgId),
    enabled: !!activeOrgId,
  });

  // Layout sits above <Routes>, so useParams() can't see :projectId — derive
  // the active project from the path instead.
  const currentProject = pathname.match(/\/projects\/([^/]+)/)?.[1] ?? "";

  const admin = isAdminOrAboveIn(me, activeOrgId);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-card-border bg-bg">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3">
          <Link to="/" className="text-fg" style={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
            Tickets<span style={{ color: "var(--muted)" }}>.</span>
          </Link>

          {/* Organisation switcher */}
          <Dropdown
            className="ml-2 w-44"
            size="sm"
            placeholder="Organisation…"
            value={activeOrgId}
            onChange={(id) => {
              if (id === "__create__") {
                navigate("/create-org");
                return;
              }
              setActiveOrg(id);
              navigate("/");
            }}
            options={[
              ...orgs.map((o) => ({ value: o.id, label: o.name })),
              { value: "__create__", label: "+ New organisation" },
            ]}
          />

          {/* Project switcher within the active org */}
          <Dropdown
            className="w-48"
            size="sm"
            placeholder="Projects…"
            value={currentProject}
            onChange={(id) => navigate(`/projects/${id}`)}
            options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          />

          <div className="ml-auto flex items-center gap-3">
            {admin && (
              <Link to="/members" className="btn btn-secondary btn-sm">
                Members
              </Link>
            )}
            {admin && (
              <Link to="/org-settings" className="btn btn-secondary btn-sm">
                Settings
              </Link>
            )}
            <NotificationsBell />
            {me && (
              <Link
                to="/profile"
                className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-card-border/40"
                title="Profile & settings"
              >
                <Avatar name={me.name} url={me.avatarUrl} size={26} />
                <span className="text-sm text-fg-soft">{me.name}</span>
              </Link>
            )}
            <button
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
              className="btn btn-secondary btn-sm"
            >
              Logout
            </button>
          </div>
        </div>
        {activeOrg && (
          <div className="mx-auto max-w-6xl px-5 pb-2 text-xs text-fg-soft">
            {activeOrg.name} · your role:{" "}
            {activeOrg.role === "SUPER_ADMIN" ? "Super Admin" : activeOrg.role.toLowerCase()}
          </div>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-5 py-7">{children}</main>
    </div>
  );
}
