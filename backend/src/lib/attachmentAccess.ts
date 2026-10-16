import { db, type Filter } from "../db/index.js";
import { isAdminOrAbove, isClient, orgRole, type AuthUser } from "./access.js";

export type AttVisibility = "INTERNAL" | "CLIENT_VISIBLE" | "SELECTED";
export const ATTACHMENT_VISIBILITIES: AttVisibility[] = ["INTERNAL", "CLIENT_VISIBLE", "SELECTED"];


export async function attachmentVisibleFilter(user: AuthUser, orgId: string): Promise<Filter> {
  if (isAdminOrAbove(user, orgId)) return {};
  const sharedIds = await db.attachmentAccess.distinct("attachmentId", { userId: user.id });
  const sharedWithMe = { visibility: "SELECTED", $or: [{ uploaderId: user.id }, { _id: { $in: sharedIds } }] };
  if (isClient(user, orgId)) return { $or: [{ visibility: "CLIENT_VISIBLE" }, sharedWithMe] };
  return { $or: [{ visibility: { $in: ["INTERNAL", "CLIENT_VISIBLE"] } }, sharedWithMe] };
}

export function canSeeAttachment(
  user: AuthUser,
  orgId: string,
  att: { visibility: AttVisibility; uploaderId: string; access?: { userId: string }[] },
): boolean {
  if (isAdminOrAbove(user, orgId)) return true;
  if (att.visibility === "CLIENT_VISIBLE") return true;
  if (att.visibility === "INTERNAL") return orgRole(user, orgId) === "DEVELOPER";
  return att.uploaderId === user.id || (att.access ?? []).some((a) => a.userId === user.id);
}

export async function projectMembers(orgId: string, projectId: string) {
  const [devAttached, clientAttached, assigned] = await Promise.all([
    db.projectDevelopers.distinct("membershipId", { projectId }),
    db.projectClients.distinct("membershipId", { projectId }),
    db.tickets.distinct("assigneeIds", { projectId }),
  ]);
  const memberships = await db.memberships.find(
    {
      orgId,
      disabled: false,
      $or: [
        { role: { $in: ["SUPER_ADMIN", "ADMIN"] } },
        { role: "DEVELOPER", _id: { $in: devAttached } },
        { role: "DEVELOPER", userId: { $in: assigned } },
        { role: "CLIENT", _id: { $in: clientAttached } },
      ],
    },
    { sort: { createdAt: 1, _id: 1 } },
  );
  const users = new Map((await db.users.find({ _id: { $in: memberships.map((m) => m.userId) } })).map((u) => [u.id, u]));
  return memberships.flatMap((m) => {
    const u = users.get(m.userId);
    return u
      ? [{ membershipId: m.id, userId: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, role: m.role }]
      : [];
  });
}

export async function projectMemberPool(orgId: string, projectId: string) {
  return (await projectMembers(orgId, projectId)).map(({ membershipId: _m, ...rest }) => rest);
}

export function parseIdList(raw: unknown): string[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.trim()) {
    const t = raw.trim();
    if (t.startsWith("[")) {
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
      }
    } else list = t.split(",");
  }
  return [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
}
