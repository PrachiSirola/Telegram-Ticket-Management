import { Router } from "express";
import { z } from "zod";
import type { OrgRole } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireOrgRole } from "../middleware/org.js";
import { isOrgSA, orgRole } from "../lib/access.js";

export const orgsRouter = Router();

/** Mask a secret for display: keep the last 4 chars. */
function mask(secret: string | null): string | null {
  if (!secret) return null;
  return `••••${secret.slice(-4)}`;
}

function serializeOrg(org: {
  id: string;
  name: string;
  telegramBotToken: string | null;
  telegramChatId: string | null;
}) {
  return {
    id: org.id,
    name: org.name,
    telegramBotToken: mask(org.telegramBotToken),
    telegramChatId: org.telegramChatId,
    telegramConfigured: Boolean(org.telegramBotToken && org.telegramChatId),
  };
}

// List my organisations (with my role in each).
orgsRouter.get("/", requireAuth, async (req, res) => {
  const user = req.user!;
  const orgs = await prisma.organization.findMany({
    where: { id: { in: user.memberships.map((m) => m.orgId) } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  res.json(
    orgs.map((o) => ({ id: o.id, name: o.name, role: orgRole(user, o.id) })),
  );
});

// Create a new organisation — the caller becomes its Super Admin. This is the
// path for existing accounts (open signup handles brand-new emails).
//
// Restricted to users who currently hold SUPER_ADMIN, ADMIN, or CLIENT in at
// least one of their existing org memberships. A user whose memberships are
// all DEVELOPER — or who has none at all (e.g. removed from their last org) —
// is blocked; they need an invite instead. This intentionally checks CURRENT
// memberships only: role history isn't tracked once a membership is deleted,
// so "zero memberships" and "developer-only" both fall on the blocked side by
// construction, which matches the intended strict behaviour without needing
// any additional audit trail.
const createSchema = z.object({ name: z.string().min(1).max(100) });
orgsRouter.post("/", requireAuth, async (req, res) => {
  const qualifies = req.user!.memberships.some((m) =>
    (["SUPER_ADMIN", "ADMIN", "CLIENT"] as OrgRole[]).includes(m.role),
  );
  if (!qualifies) {
    return res.status(403).json({
      error: "Only Super Admins, Admins, or Clients can create organisations. Ask your administrator for an invite.",
    });
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Organisation name is required." });
  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({ data: { name: parsed.data.name.trim() } });
    await tx.orgMembership.create({
      data: { userId: req.user!.id, orgId: created.id, role: "SUPER_ADMIN" },
    });
    return created;
  });
  res.status(201).json({ id: org.id, name: org.name, role: "SUPER_ADMIN" });
});

// Org settings (name, Telegram). Super Admin only. Bot token is write-only:
// responses carry a masked value; sending an empty string clears it.
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  telegramBotToken: z.string().max(200).optional(),
  telegramChatId: z.string().max(100).optional(),
});

// Settings are visible to SA and Admins (Admins only get the Telegram part).
orgsRouter.get(
  "/:orgId/settings",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.params.orgId } });
    res.json(serializeOrg(org));
  },
);

orgsRouter.patch(
  "/:orgId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
    const b = parsed.data;
    // Admins may only manage Telegram config; renaming the org is SA-only.
    if (b.name !== undefined && !isOrgSA(req.user!, req.params.orgId)) {
      return res.status(403).json({ error: "Only the Super Admin can rename the organisation" });
    }
    const org = await prisma.organization.update({
      where: { id: req.params.orgId },
      data: {
        ...(b.name !== undefined ? { name: b.name.trim() } : {}),
        ...(b.telegramBotToken !== undefined
          ? { telegramBotToken: b.telegramBotToken || null }
          : {}),
        ...(b.telegramChatId !== undefined ? { telegramChatId: b.telegramChatId || null } : {}),
      },
    });
    res.json(serializeOrg(org));
  },
);

// Delete the organisation (cascades projects, tickets, memberships, invites).
orgsRouter.delete(
  "/:orgId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN"),
  async (req, res) => {
    await prisma.organization.delete({ where: { id: req.params.orgId } });
    res.json({ ok: true });
  },
);

// Hand the Super Admin role to an existing Admin; the old SA becomes an Admin.
// Single transaction (demote first — the partial unique index enforces the
// exactly-one-SA invariant).
const transferSchema = z.object({ userId: z.string().min(1) });
orgsRouter.post(
  "/:orgId/transfer-ownership",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN"),
  async (req, res) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "userId is required" });
    const orgId = req.params.orgId;
    const target = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: parsed.data.userId, orgId } },
    });
    if (!target || target.disabled || target.role !== "ADMIN") {
      return res.status(400).json({ error: "Ownership can only be transferred to an active Admin" });
    }
    await prisma.$transaction([
      prisma.orgMembership.update({
        where: { userId_orgId: { userId: req.user!.id, orgId } },
        data: { role: "ADMIN" },
      }),
      prisma.orgMembership.update({
        where: { id: target.id },
        data: { role: "SUPER_ADMIN" },
      }),
    ]);
    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

// Full member list (incl. disabled) — management view for SA/Admin.
//
// Pagination is OPT-IN, same convention as the projects list: `page` present
// → `{ items, total, page, pageSize }` envelope (used by the Members page);
// omitted → the plain array as always (used by OrgSettings' ownership-transfer
// admin picker, which needs the complete list regardless of any page state).
const MEMBERS_MAX_PAGE_SIZE = 100;

orgsRouter.get(
  "/:orgId/members",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const where = { orgId: req.params.orgId };
    const include = {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      projectAccess: { select: { projectId: true } },
    };
    const orderBy = [{ disabled: "asc" as const }, { createdAt: "asc" as const }];
    const serializeMember = (m: any) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      disabled: m.disabled,
      projectIds: m.projectAccess.map((p: { projectId: string }) => p.projectId),
      createdAt: m.createdAt,
    });

    const pageRaw = req.query.page;
    if (pageRaw === undefined) {
      const members = await prisma.orgMembership.findMany({ where, include, orderBy });
      return res.json(members.map(serializeMember));
    }

    const page = Math.max(1, parseInt(String(pageRaw), 10) || 1);
    const pageSize = Math.min(
      MEMBERS_MAX_PAGE_SIZE,
      Math.max(1, parseInt(String(req.query.pageSize ?? "10"), 10) || 10),
    );
    const [items, total] = await prisma.$transaction([
      prisma.orgMembership.findMany({
        where,
        include,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.orgMembership.count({ where }),
    ]);
    res.json({ items: items.map(serializeMember), total, page, pageSize });
  },
);

/**
 * Guard for member-management writes. Rules:
 *  - The SA membership can never be modified (only transfer/delete-org).
 *  - You can't modify yourself.
 *  - ADMIN targets: SA only. DEVELOPER/CLIENT targets: SA or ADMIN.
 */
async function loadManagedMember(req: any, res: any) {
  const orgId = req.params.orgId;
  const target = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: req.params.userId, orgId } },
  });
  if (!target) {
    res.status(404).json({ error: "Member not found" });
    return null;
  }
  if (target.role === "SUPER_ADMIN") {
    res.status(400).json({ error: "The Super Admin can't be modified. Transfer ownership instead." });
    return null;
  }
  if (target.userId === req.user!.id) {
    res.status(400).json({ error: "You can't modify your own membership" });
    return null;
  }
  if (target.role === "ADMIN" && !isOrgSA(req.user!, orgId)) {
    res.status(403).json({ error: "Only the Super Admin can manage Admins" });
    return null;
  }
  return target;
}

const memberPatchSchema = z.object({
  role: z.enum(["ADMIN", "DEVELOPER", "CLIENT"]).optional(),
  disabled: z.boolean().optional(),
});

orgsRouter.patch(
  "/:orgId/members/:userId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const parsed = memberPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
    const target = await loadManagedMember(req, res);
    if (!target) return;
    // Promoting someone TO Admin is Admin-management — SA only.
    if (parsed.data.role === "ADMIN" && !isOrgSA(req.user!, req.params.orgId)) {
      return res.status(403).json({ error: "Only the Super Admin can promote to Admin" });
    }
    const updated = await prisma.orgMembership.update({
      where: { id: target.id },
      data: parsed.data,
    });
    res.json({ ok: true, role: updated.role, disabled: updated.disabled });
  },
);

// Remove a member from the org entirely (project attachments cascade).
orgsRouter.delete(
  "/:orgId/members/:userId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const target = await loadManagedMember(req, res);
    if (!target) return;
    await prisma.orgMembership.delete({ where: { id: target.id } });
    res.json({ ok: true });
  },
);