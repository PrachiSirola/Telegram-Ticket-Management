import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, useAuth } from "../auth";
import { useOrg } from "../org";
import { Avatar } from "./ui";
import { Dropdown } from "./Dropdown";
import { NotificationsBell } from "./NotificationsBell";
import { AppShell } from "./layout";
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

  return (
    <AppShell
      admin={admin}
      topbarLeft={
        <div className="flex items-center gap-4">

          <div className="hidden xl:flex flex-col leading-tight">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              Workspace
            </span>
            <span className="text-sm font-semibold text-fg">
              {activeOrg?.name || "Organisation"}
            </span>
          </div>

          <Dropdown
            className="w-52"
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
              {
                value: "__create__",
                label: "+ New organisation",
              },
            ]}
          />

          <Dropdown
            className="w-52"
            size="sm"
            placeholder="Project"
            value={currentProject}
            onChange={(id) => navigate(`/projects/${id}`)}
            options={(projects ?? []).map((p) => ({
              value: p.id,
              label: p.name,
            }))}
          />
        </div>
      }
      topbarRight={
        <div className="flex items-center gap-3">

          <NotificationsBell />

          {me && (
            <Link
              to="/profile"
              className="flex items-center gap-3 rounded-xl border border-card-border bg-white px-3 py-2 transition-all duration-200 hover:border-primary/30 hover:shadow-sm"
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