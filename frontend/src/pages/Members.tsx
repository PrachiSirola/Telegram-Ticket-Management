import { humanize, toast } from "../lib/toast";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, isOrgSA, useAuth } from "../auth";
import { useOrg } from "../org";
import { TypeToConfirmModal } from "../components/TypeToConfirmModal";
import { Dropdown, MultiDropdown } from "../components/Dropdown";
import { Pagination } from "../components/Pagination";
import { Avatar } from "../components/ui";
import { IconPlus, IconSearch } from "../components/Icons";
import { BulkInviteModal } from "../components/BulkInviteModal";
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
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);


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
  const [disabling, setDisabling] = useState<OrgMember | null>(null);
  const { data: removeImpact, isLoading: removeImpactLoading } = useQuery({
    queryKey: ["member-impact", activeOrgId, removing?.userId],
    queryFn: () => api.memberImpact(activeOrgId, removing!.userId),
    enabled: !!removing && !!activeOrgId,
    staleTime: 0,
    gcTime: 0,
  });
  const apiMsg = (e: any, fb: string) => e?.response?.data?.error ?? fb;
  const [bulkOpen, setBulkOpen] = useState(false);

  const patchMember = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: { role?: any; disabled?: boolean; confirmName?: string } }) =>
      api.updateMember(activeOrgId, userId, data),
    meta: { errorTitle: "Couldn't update the member" },
    onMutate: ({ userId }) => {
      const m = members?.find((x) => x.userId === userId);
      return { name: m?.name ?? "The member", role: m?.role, disabled: m?.disabled };
    },
    onSuccess: (_res, { data }, before) => {
      const name = before?.name ?? "The member";
      if (data.role && data.role !== before?.role)
        toast.success(`${name}'s role changed from ${humanize(before?.role)} to ${humanize(data.role)}.`);
      else if (typeof data.disabled === "boolean")
        toast.success(data.disabled ? `${name}'s account was disabled. They can no longer sign in.` : `${name}'s account was re-enabled.`);
      else toast.success(`${name} was updated.`);
      setDisabling(null);
      qc.invalidateQueries({ queryKey: ["orgMembers", activeOrgId] });
    },
  });
  const removeMember = useMutation({
    mutationFn: (m: OrgMember) => api.removeMember(activeOrgId, m.userId, m.name),
    meta: { errorTitle: "Couldn't remove the member" },
    onSuccess: () => {
      toast.success(`${removing?.name ?? "The member"} was removed from ${activeOrg?.name ?? "the organisation"}.`);
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ["orgMembers", activeOrgId] });
    },
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => api.revokeInvite(activeOrgId, inviteId),
    meta: { errorTitle: "Couldn't revoke the invitation" },
    onSuccess: (_d, inviteId) => {
      const email = invites?.find((i) => i.id === inviteId)?.email;
      toast.success(`Invitation${email ? ` for ${email}` : ""} was revoked.`);
      qc.invalidateQueries({ queryKey: ["invites", activeOrgId] });
    },
  });
  const resend = useMutation({
    mutationFn: (inviteId: string) => api.resendInvite(activeOrgId, inviteId),
    meta: { errorTitle: "Couldn't resend the invitation" },
    onSuccess: (_d, inviteId) => {
      const email = invites?.find((i) => i.id === inviteId)?.email;
      toast.success(`Invitation resent${email ? ` to ${email}` : ""}.`);
    },
  });


  useEffect(() => {
    if (paged && paged.items.length === 0 && page > 1) setPage(page - 1);
  }, [paged, page]);

  if (!admin) return <Navigate to="/" replace />;

  const canManage = (m: OrgMember) =>
    m.role !== "SUPER_ADMIN" && m.userId !== me?.id && (sa || m.role !== "ADMIN");

  const pending = (invites ?? []).filter((i) => i.status === "PENDING");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">{activeOrg?.name}</div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">Members</h1>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setBulkOpen(true)}>
          <IconPlus size={15} />
          Bulk invite
        </button>
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
                    onClick={() => {
                      patchMember.reset();
                      if (m.disabled) patchMember.mutate({ userId: m.userId, data: { disabled: false } });
                      else setDisabling(m);
                    }}
                  >
                    {m.disabled ? "Enable" : "Disable"}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => { removeMember.reset(); setRemoving(m); }}>
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

      <BulkInviteModal
        key={activeOrgId}
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        orgId={activeOrgId}
        orgName={activeOrg?.name ?? ""}
        canInviteAdmin={sa}
      />

      <TypeToConfirmModal
        open={!!removing}
        title="Remove member?"
        confirmLabel="Remove member"
        pendingLabel="Removing…"
        pending={removeMember.isPending}
        loading={removeImpactLoading}
        error={removeMember.isError ? apiMsg(removeMember.error, "Couldn't remove the member.") : null}
        testId="remove-member"
        fields={[{ label: "Type the member's name to confirm", expected: removing?.name ?? "" }]}
        onConfirm={() => removeMember.mutate(removing!)}
        onClose={() => setRemoving(null)}
      >
        <p>
          <span className="font-medium text-fg">{removing?.name}</span> will lose access to{" "}
          {activeOrg?.name ?? "this organisation"} and be removed from:
        </p>
        {removeImpact && (
          <ul className="mt-2 list-disc pl-5" data-testid="remove-member-impact">
            <li>{removeImpact.projects} {removeImpact.projects === 1 ? "project" : "projects"} they're attached to</li>
            <li>
              {removeImpact.openAssignedTickets} open {removeImpact.openAssignedTickets === 1 ? "ticket" : "tickets"}{" "}
              currently assigned to them (these stay, but will have no active owner)
            </li>
          </ul>
        )}
        <p className="mt-2">Their tickets and comments stay for history. They'd need a new invitation to rejoin.</p>
      </TypeToConfirmModal>

      <TypeToConfirmModal
        open={!!disabling}
        title="Disable member?"
        confirmLabel="Disable member"
        pendingLabel="Disabling…"
        pending={patchMember.isPending}
        error={patchMember.isError && disabling ? apiMsg(patchMember.error, "Couldn't disable the member.") : null}
        testId="disable-member"
        fields={[{ label: "Type the member's name to confirm", expected: disabling?.name ?? "" }]}
        onConfirm={() => patchMember.mutate({ userId: disabling!.userId, data: { disabled: true, confirmName: disabling!.name } })}
        onClose={() => setDisabling(null)}
      >
        <p>
          <span className="font-medium text-fg">{disabling?.name}</span> can no longer sign in
          to {activeOrg?.name ?? "this organisation"}. Nothing is deleted — you can enable the account again at any
          time.
        </p>
      </TypeToConfirmModal>
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
    meta: { errorTitle: "Couldn't create the invitation" },
    onSuccess: (data) => {
      toast.success(`Invitation for ${data.email} created as ${humanize(data.role ?? role)}. Copy the link below to share it directly.`);
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
          navigator.clipboard.writeText(url).then(
            () => toast.success("Invitation link copied to clipboard."),
            () => toast.error("Couldn't copy the link. Select it and copy manually."),
          );
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}