import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, isOrgSA, useAuth } from "../auth";
import { useOrg } from "../org";
import { ConfirmModal } from "../components/ConfirmModal";
import { Dropdown, MultiDropdown } from "../components/Dropdown";
import { Pagination } from "../components/Pagination";
import { Avatar } from "../components/ui";
import { IconPlus, IconSearch } from "../components/Icons";
import { isAllowedEmailDomain } from "../lib/emailDomains";
import type { OrgMember } from "../types";
import { EmailDomainInput } from "../components/EmailDomainInput";
import { Link } from "react-router-dom";

const MEMBERS_PAGE_SIZE = 10;

export default function Members() {
  const { me } = useAuth();
  const { activeOrgId, activeOrg } = useOrg();
  const qc = useQueryClient();

  const sa = isOrgSA(me, activeOrgId);
  const admin = isAdminOrAboveIn(me, activeOrgId);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce the search box so we're not firing a request on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // A new search always lands back on page 1.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data: paged } = useQuery({
    queryKey: ["orgMembers", activeOrgId, "paged", page, debouncedSearch],
    queryFn: () =>
      api.orgMembersPaged(activeOrgId, { page, pageSize: MEMBERS_PAGE_SIZE, q: debouncedSearch }),
    enabled: !!activeOrgId && admin,
  });
  const members = paged?.items;
  const { data: invites } = useQuery({
    queryKey: ["invites", activeOrgId],
    queryFn: () => api.invites(activeOrgId),
    enabled: !!activeOrgId && admin,
  });

  const [removing, setRemoving] = useState<OrgMember | null>(null);

  const patchMember = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: { role?: any; disabled?: boolean } }) =>
      api.updateMember(activeOrgId, userId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orgMembers", activeOrgId] }),
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeMember(activeOrgId, userId),
    onSuccess: () => {
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ["orgMembers", activeOrgId] });
    },
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => api.revokeInvite(activeOrgId, inviteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites", activeOrgId] }),
  });
  const resend = useMutation({
    mutationFn: (inviteId: string) => api.resendInvite(activeOrgId, inviteId),
  });

  // If removing the last member on a page empties it (and it's not page 1),
  // step back a page rather than showing a stranded empty page.
  useEffect(() => {
    if (paged && paged.items.length === 0 && page > 1) setPage(page - 1);
  }, [paged, page]);

  if (!admin) return <Navigate to="/" replace />;

  const canManage = (m: OrgMember) =>
    m.role !== "SUPER_ADMIN" && m.userId !== me?.id && (sa || m.role !== "ADMIN");

  const pending = (invites ?? []).filter((i) => i.status === "PENDING");

  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-1">{activeOrg?.name}</div>
        <h1 className="text-2xl font-bold tracking-tight text-fg">Members</h1>
      </div>

      <InviteForm
        key={activeOrgId /* reset typed email/projects when the workspace changes */}
        orgId={activeOrgId}
        orgName={activeOrg?.name ?? ""}
        canInviteAdmin={sa}
      />

      {pending.length > 0 && (
        <section>
          <div className="eyebrow mb-3">Pending invites</div>
          <div className="card divide-line overflow-hidden">
            {pending.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-fg">{i.email}</div>
                  <div className="text-xs text-muted">
                    {i.role.toLowerCase()} · expires {new Date(i.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                {i.inviteUrl && <CopyLink url={i.inviteUrl} />}
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={resend.isPending}
                  onClick={() => resend.mutate(i.id)}
                >
                  {resend.isPending && resend.variables === i.id
                    ? "Sending…"
                    : resend.isSuccess && resend.variables === i.id
                      ? "Sent ✓"
                      : "Resend email"}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(i.id)}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="eyebrow">Members</div>
          <div className="relative" style={{ minWidth: 240 }}>
            <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="input pl-9"
              placeholder="Search members…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="card divide-line overflow-hidden">
          {members?.length === 0 && (
            <div className="px-5 py-10 text-center text-sm font-medium text-fg-soft">
              {debouncedSearch ? `No members match "${debouncedSearch}".` : "No members yet."}
            </div>
          )}
          {members?.map((m) => (
            <div key={m.membershipId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
             <Link to={`/members/${m.userId}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg -m-1.5 p-1.5 transition-colors hover:bg-accent/50">
                <Avatar name={m.name} url={m.avatarUrl} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-fg">{m.name}</span>
                    {m.userId === me?.id && <span className="eyebrow">You</span>}
                    {m.disabled && <span className="badge b-danger">Disabled</span>}
                    {m.role === "SUPER_ADMIN" && <span className="badge b-sage">Super Admin</span>}
                  </div>
                  <div className="text-xs text-muted">{m.email}</div>
                </div>
              </Link>

              {canManage(m) ? (
                <div className="flex items-center gap-2">
                  <Dropdown
                    className="w-36"
                    size="sm"
                    value={m.role}
                    onChange={(role) => patchMember.mutate({ userId: m.userId, data: { role } })}
                    options={[
                      ...(sa ? [{ value: "ADMIN", label: "Admin" }] : []),
                      { value: "DEVELOPER", label: "Developer" },
                      { value: "CLIENT", label: "Client" },
                    ]}
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      patchMember.mutate({ userId: m.userId, data: { disabled: !m.disabled } })
                    }
                  >
                    {m.disabled ? "Enable" : "Disable"}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => setRemoving(m)}>
                    Remove
                  </button>
                </div>
              ) : (
                <span className="eyebrow">
                  {m.role === "SUPER_ADMIN" ? "Owner" : m.role.toLowerCase()}
                </span>
              )}
            </div>
          ))}
        </div>
        {patchMember.isError && (
          <p className="mt-2 text-sm text-danger">
            {(patchMember.error as any)?.response?.data?.error ?? "Update failed."}
          </p>
        )}
        {paged && (
          <Pagination
            page={paged.page}
            total={paged.total}
            pageSize={paged.pageSize}
            onPageChange={setPage}
          />
        )}
      </section>

      <ConfirmModal
        open={!!removing}
        title="Remove member?"
        message={
          <>
            <span className="font-medium">{removing?.name}</span> will lose access to this
            organisation. Their tickets and comments stay for history.
          </>
        }
        pending={removeMember.isPending}
        onConfirm={() => removeMember.mutate(removing!.userId)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

function InviteForm({
  orgId,
  orgName,
  canInviteAdmin,
}: {
  orgId: string;
  orgName: string;
  canInviteAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [role, setRole] = useState("DEVELOPER");
  const [projectIds, setProjectIds] = useState<string[]>([]);

  const emailTrimmed = email.trim();
  // Only flags once there's a domain to judge, so the error doesn't flash
  // while the person is still typing the local part.
  const domainInvalid = emailTrimmed.includes("@") && !isAllowedEmailDomain(emailTrimmed);

  const { data: projects } = useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => api.projects(orgId),
    enabled: !!orgId,
  });

  const mut = useMutation({
    mutationFn: () =>
      api.invite(orgId, {
        email: email.trim(),
        role,
        ...(role === "CLIENT" || role === "DEVELOPER" ? { projectIds } : {}),
      }),
    onSuccess: () => {
      setEmail("");
      setEmailTouched(false);
      setProjectIds([]);
      qc.invalidateQueries({ queryKey: ["invites", orgId] });
    },
  });

  const canSubmit =
    !!emailTrimmed &&
    !domainInvalid &&
    (role !== "CLIENT" || projectIds.length > 0) &&
    !mut.isPending;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1" style={{ minWidth: 200 }}>
          <div className="eyebrow mb-1.5">Email</div>
          <EmailDomainInput
            value={email}
            onChange={setEmail}
            onBlur={() => setEmailTouched(true)}
          />
          {emailTouched && emailTrimmed && domainInvalid && (
            <p className="mt-1.5 text-xs text-danger">Please enter a valid email address.</p>
          )}
        </div>
        <div style={{ minWidth: 150 }}>
          <div className="eyebrow mb-1.5">Role</div>
          <Dropdown
            value={role}
            onChange={(v) => { setRole(v); setProjectIds([]); }}
            options={[
              ...(canInviteAdmin ? [{ value: "ADMIN", label: "Admin" }] : []),
              { value: "DEVELOPER", label: "Developer" },
              { value: "CLIENT", label: "Client" },
            ]}
          />
        </div>
        {role === "CLIENT" && (
          <div className="flex-1" style={{ minWidth: 180 }}>
            <div className="eyebrow mb-1.5">Projects</div>
            <MultiDropdown
              values={projectIds}
              onChange={setProjectIds}
              placeholder="Select projects…"
              options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
        )}
        {role === "DEVELOPER" && (
          <div className="flex-1" style={{ minWidth: 180 }}>
            <div className="eyebrow mb-1.5">Projects (optional)</div>
            <MultiDropdown
              values={projectIds}
              onChange={setProjectIds}
              placeholder="Assign to projects…"
              options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
        )}
        <button className="btn btn-primary btn-sm" disabled={!canSubmit} onClick={() => mut.mutate()}>
          <IconPlus size={15} />
          {mut.isPending ? "Creating…" : "Create invite"}
        </button>
      </div>

      {mut.isError && (
        <p className="mt-3 text-sm text-danger">
          {(mut.error as any)?.response?.data?.error ?? "Failed to create invite."}
        </p>
      )}

      {mut.data && (
        <div className="card-subtle mt-4 p-4">
          <p className="mb-2 text-xs text-fg-soft">
            Invite to <strong>{orgName}</strong> emailed to <strong>{mut.data.email}</strong>. You can also share the link directly — the invitee uses it to set up
            their account (or accept with an existing one):
          </p>
          <CopyLink url={mut.data.inviteUrl} />
        </div>
      )}
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-64 flex-1 items-center gap-1.5">
      <input readOnly value={url} className="input text-xs" style={{ padding: "6px 8px" }} />
      <button
        className="btn btn-secondary btn-sm shrink-0"
        onClick={() => {
          navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}