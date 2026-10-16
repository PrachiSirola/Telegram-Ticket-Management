import { z } from "zod";
import { db } from "../db/index.js";

export const MAX_ASSIGNEES = 25;

export interface AssignableMember {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "DEVELOPER";
}

export async function assignablePool(orgId: string, projectId: string): Promise<AssignableMember[]> {
  const attached = await db.projectDevelopers.distinct("membershipId", { projectId });
  const memberships = await db.memberships.find(
    {
      orgId,
      disabled: false,
      $or: [{ role: { $in: ["SUPER_ADMIN", "ADMIN"] } }, { role: "DEVELOPER", _id: { $in: attached } }],
    },
    { sort: { createdAt: 1, _id: 1 } },
  );
  const users = new Map(
    (await db.users.find({ _id: { $in: memberships.map((m) => m.userId) } })).map((u) => [u.id, u]),
  );
  return memberships.flatMap((m) => {
    const u = users.get(m.userId);
    return u
      ? [{ userId: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl ?? null, role: m.role as AssignableMember["role"] }]
      : [];
  });
}


export const assigneeFields = {
  assigneeIds: z.array(z.string().min(1)).max(MAX_ASSIGNEES, `At most ${MAX_ASSIGNEES} assignees.`).optional(),
  assigneeId: z.string().nullish(),
};


export function requestedAssignees(body: { assigneeIds?: string[]; assigneeId?: string | null }): string[] | undefined {
  if (body.assigneeIds !== undefined) return [...new Set(body.assigneeIds)];
  if (body.assigneeId !== undefined) return body.assigneeId ? [body.assigneeId] : [];
  return undefined;
}

export type AssigneeCheck = { ok: true; ids: string[] } | { ok: false; error: string };

export async function validateAssignees(
  requested: string[],
  orgId: string,
  projectId: string,
  current: string[],
): Promise<AssigneeCheck> {
  const ids = [...new Set(requested)];
  const added = ids.filter((id) => !current.includes(id));
  if (added.length === 0) return { ok: true, ids };
  const pool = new Set((await assignablePool(orgId, projectId)).map((m) => m.userId));
  const bad = added.filter((id) => !pool.has(id));
  if (bad.length) {
    const names = new Map((await db.users.find({ _id: { $in: bad } })).map((u) => [u.id, u.name]));
    const label = bad.map((id) => names.get(id) ?? "Unknown user").join(", ");
    return { ok: false, error: `Only members of this project can be assigned. Not allowed: ${label}.` };
  }
  return { ok: true, ids };
}

export function diffAssignees(before: string[], after: string[]) {
  return {
    added: after.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !after.includes(id)),
  };
}
