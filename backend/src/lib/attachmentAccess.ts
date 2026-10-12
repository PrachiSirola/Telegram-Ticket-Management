import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { isAdminOrAbove, isClient, orgRole, type AuthUser } from "./access.js";

export type AttVisibility = "INTERNAL" | "CLIENT_VISIBLE" | "SELECTED";
export const ATTACHMENT_VISIBILITIES: AttVisibility[] = ["INTERNAL", "CLIENT_VISIBLE", "SELECTED"];
export function attachmentVisibleWhere(user: AuthUser, orgId: string): Prisma.AttachmentWhereInput {
  if (isAdminOrAbove(user, orgId)) return {};
  const sharedWithMe: Prisma.AttachmentWhereInput = {
    visibility: "SELECTED",
    OR: [{ uploaderId: user.id }, { access: { some: { userId: user.id } } }],
  };
  if (isClient(user, orgId)) {
    return { OR: [{ visibility: "CLIENT_VISIBLE" }, sharedWithMe] };
  }
  return { OR: [{ visibility: { in: ["INTERNAL", "CLIENT_VISIBLE"] } }, sharedWithMe] };
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

export async function projectMemberPool(orgId: string, projectId: string) {
  const memberships = await prisma.orgMembership.findMany({
    where: {
      orgId,
      disabled: false,
      OR: [
        { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
        { role: "DEVELOPER", projectDevAccess: { some: { projectId } } },
        { role: "DEVELOPER", user: { assignedTickets: { some: { projectId } } } },
        { role: "CLIENT", projectAccess: { some: { projectId } } },
      ],
    },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    avatarUrl: m.user.avatarUrl,
    role: m.role,
  }));
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