import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, isDeveloperIn, canCreateOrg, useAuth } from "../auth";
import { useOrg } from "../org";
import { Avatar } from "./ui";
import { Dropdown } from "./Dropdown";
import { NotificationsBell } from "./NotificationsBell";
import { AppShell } from "./layout/AppShell";
import { IconLogOut, IconAlertTriangle } from "./Icons";
import { Modal } from "./Modal";
import { useState, type ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const { orgs, activeOrg, activeOrgId, setActiveOrg } = useOrg();

  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [showLogout, setShowLogout] = useState(false);

  const { data: projects } = useQuery({
    queryKey: ["projects", activeOrgId],
    queryFn: () => api.projects(activeOrgId),
    enabled: !!activeOrgId,
  });

  const currentProject =
    pathname.match(/\/projects\/([^/]+)/)?.[1] ?? "";

  const admin = isAdminOrAboveIn(me, activeOrgId);
  const developer = isDeveloperIn(me, activeOrgId);

  return (
    <AppShell
      admin={admin}
      developer={developer}
      topbarLeft={
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 lg:gap-4">

          <div className="hidden xl:flex flex-col leading-tight">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              Workspace
            </span>
            <span className="text-sm font-semibold text-fg">
              {activeOrg?.name || "Organisation"}
            </span>
          </div>

         <Dropdown
          className="w-28 sm:w-40 md:w-48 lg:w-52"
          size="sm"
          placeholder="Organisation"
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
            ...orgs.map((o) => ({
              value: o.id,
              label: o.name,
            })),
            ...(canCreateOrg(me)
              ? [
                  {
                    value: "__create__",
                    label: "+ New organisation",
                  },
                ]
              : []),
          ]}
        />

        {/* Project switcher — hidden on phones; on mobile the Dashboard's
            project grid and the sidebar nav already cover navigation, so
            this is the first thing to drop when the topbar is short on room. */}
        <div className="hidden md:block">
          <Dropdown
            className="w-40 lg:w-52"
            size="sm"
            placeholder="Project"
            value={currentProject}
            onChange={(id) => navigate(`/projects/${id}`)}
            searchable
            searchPlaceholder="Search projects…"
            options={(projects ?? []).map((p) => ({
              value: p.id,
              label: p.name,
            }))}
          />
        </div>
        </div>
      }
      topbarRight={
        <div className="flex items-center gap-2 sm:gap-3">

          <NotificationsBell />

          {/* Avatar/name card — hidden on phones; Profile is already reachable
              from the sidebar footer, so this is a nice-to-have shortcut on
              larger screens rather than something worth the topbar space here. */}
          {me && (
            <Link
              to="/profile"
              className="hidden items-center gap-2 rounded-xl border border-card-border bg-white px-2 py-1.5 transition-all duration-200 hover:border-primary/30 hover:shadow-sm sm:flex sm:gap-3 sm:px-3 sm:py-2"
            >
              <Avatar
                name={me.name}
                url={me.avatarUrl}
                size={32}
              />

              <div className="hidden lg:block leading-tight">
                <div className="text-sm font-semibold text-fg">
                  {me.name}
                </div>
                <div className="text-[11px] text-muted">
                  {activeOrg?.role === "SUPER_ADMIN"
                    ? "Super Admin"
                    : activeOrg?.role}
                </div>
              </div>
            </Link>
          )}

          
            <button
              onClick={() => setShowLogout(true)}
              className="btn btn-secondary btn-sm"
              title="Log out"
            >
              <IconLogOut size={16} />
              <span className="hidden sm:inline">Logout</span>
            </button>
            {/* Hover tooltip — only relevant on phones where the button is
                icon-only; at sm+ the label is already shown inline so this
                stays hidden there to avoid a redundant double-label. */}
            <span className="pointer-events-none absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-lg bg-fg px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 sm:hidden">
              Logout
            </span>
        </div>
      }
    >
      {children}

      <Modal open={showLogout} onClose={() => setShowLogout(false)} title="Log out?" width={380}>
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn/10 text-warn">
            <IconAlertTriangle size={20} />
          </div>
          <p className="text-sm text-fg-soft">
            Are you sure you want to log out? You'll need to sign in again to access your workspace.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => setShowLogout(false)}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            <IconLogOut size={15} />
            Log out
          </button>
        </div>
      </Modal>
    </AppShell>
  );
}