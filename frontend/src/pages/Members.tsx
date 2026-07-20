import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, isOrgSA, useAuth } from "../auth";
import { useOrg } from "../org";
import { ConfirmModal } from "../components/ConfirmModal";
import { Dropdown, MultiDropdown } from "../components/Dropdown";
import { Avatar } from "../components/ui";
import type { OrgMember } from "../types";

export default function Members() {
  const { me } = useAuth();
  const { activeOrgId, activeOrg } = useOrg();
  const qc = useQueryClient();

  const sa = isOrgSA(me, activeOrgId);
  const admin = isAdminOrAboveIn(me, activeOrgId);

  const { data: members } = useQuery({
    queryKey: ["orgMembers", activeOrgId],
    queryFn: () => api.orgMembers(activeOrgId),
    enabled: !!activeOrgId && admin,
  });
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

  if (!admin) return <Navigate to="/" replace />;

  // Which members can I manage? SA manages everyone below them; Admins manage
  // Developers/Clients only. Nobody manages the SA or themselves.
  const canManage = (m: OrgMember) =>
    m.role !== "SUPER_ADMIN" && m.userId !== me?.id && (sa || m.role !== "ADMIN");

  const pending = (invites ?? []).filter((i) => i.status === "PENDING");

  return (
    <div className="space-y-10">
      <div>
        <div className="eyebrow mb-1">{activeOrg?.name}</div>
        <h1 className="text-2xl font-bold tracking-tight">Members</h1>
      </div>

      <InviteForm orgId={activeOrgId} canInviteAdmin={sa} />

      {pending.length > 0 && (
        <section>
          <div className="eyebrow mb-3">Pending invites</div>
          <div className="card divide-line">
            {pending.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i.email}</div>
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
        <div className="eyebrow mb-3">Members</div>
        <div className="card divide-line">
          {members?.map((m) => (
            <div key={m.membershipId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar name={m.name} url={m.avatarUrl} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.name}</span>
                  {m.userId === me?.id && <span className="eyebrow">You</span>}
                  {m.disabled && <span className="badge b-danger">Disabled</span>}
                  {m.role === "SUPER_ADMIN" && <span className="badge b-sage">Super Admin</span>}
                </div>
                <div className="text-xs text-muted">{m.email}</div>
              </div>

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

function InviteForm({ orgId, canInviteAdmin }: { orgId: string; canInviteAdmin: boolean }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("DEVELOPER");
  const [projectIds, setProjectIds] = useState<string[]>([]);

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
        ...(role === "CLIENT" ? { projectIds } : {}),
      }),
    onSuccess: () => {
      setEmail("");
      setProjectIds([]);
      qc.invalidateQueries({ queryKey: ["invites", orgId] });
    },
  });

  const canSubmit =
    !!email.trim() && (role !== "CLIENT" || projectIds.length > 0) && !mut.isPending;

  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1" style={{ minWidth: 200 }}>
          <div className="eyebrow mb-1">Email</div>
          <input
            className="input"
            type="email"
            placeholder="person@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div style={{ minWidth: 150 }}>
          <div className="eyebrow mb-1">Role</div>
          <Dropdown
            value={role}
            onChange={setRole}
            options={[
              ...(canInviteAdmin ? [{ value: "ADMIN", label: "Admin" }] : []),
              { value: "DEVELOPER", label: "Developer" },
              { value: "CLIENT", label: "Client" },
            ]}
          />
        </div>
        {role === "CLIENT" && (
          <div className="flex-1" style={{ minWidth: 180 }}>
            <div className="eyebrow mb-1">Projects</div>
            <MultiDropdown
              values={projectIds}
              onChange={setProjectIds}
              placeholder="Select projects…"
              options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
        )}
        <button className="btn btn-primary btn-sm" disabled={!canSubmit} onClick={() => mut.mutate()}>
          {mut.isPending ? "Creating…" : "Create invite"}
        </button>
      </div>

      {mut.isError && (
        <p className="mt-3 text-sm text-danger">
          {(mut.error as any)?.response?.data?.error ?? "Failed to create invite."}
        </p>
      )}

      {mut.data && (
        <div className="card-subtle mt-3 p-3">
          <p className="mb-2 text-xs text-fg-soft">
            Invite emailed. You can also share the link directly — the invitee uses it to set up
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
    <div className="flex min-w-64 flex-1 items-center gap-1">
      <input readOnly value={url} className="input text-xs" style={{ padding: "4px 6px" }} />
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
