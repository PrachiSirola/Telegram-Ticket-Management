import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { canAccessOrg, isClient, membershipIn } from "../lib/access.js";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "../lib/password.js";

export const meRouter = Router();

const userSelect = { select: { id: true, name: true, email: true, avatarUrl: true } };

// --- Profile ---

const profileSchema = z.object({ name: z.string().min(1).max(100) });

meRouter.patch("/profile", requireAuth, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Name is required." });
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { name: parsed.data.name.trim() },
    select: { id: true, name: true, email: true, avatarUrl: true },
  });
  res.json(user);
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH, {
    message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  }),
});

meRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  // Reload with the hash (req.user's shape may not carry it forward).
  const current = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const ok = await verifyPassword(parsed.data.currentPassword, current.passwordHash);
  if (!ok) return res.status(400).json({ error: "Current password is incorrect." });

  await prisma.user.update({
    where: { id: current.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });
  res.json({ ok: true });
});

// --- "My Tickets" dashboard, scoped to one org. ?filter=assigned | reported ---
meRouter.get("/tickets", requireAuth, async (req, res) => {
  const user = req.user!;
  const orgId = String(req.query.orgId ?? "");
  const filter = (req.query.filter as string) ?? "assigned";
  if (!orgId || !canAccessOrg(user, orgId)) {
    return res.status(404).json({ error: "Organisation not found" });
  }

  // Clients only see tickets in projects they're attached to.
  const projectScope = isClient(user, orgId)
    ? {
        project: {
          orgId,
          clients: { some: { membershipId: membershipIn(user, orgId)!.id } },
        },
      }
    : { project: { orgId } };

  const who = filter === "reported" ? { reporterId: user.id } : { assigneeId: user.id };

  const tickets = await prisma.ticket.findMany({
    where: { ...projectScope, ...who },
    include: {
      assignee: userSelect,
      reporter: userSelect,
      project: { select: { id: true, name: true, orgId: true } },
    },
    orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
  });
  res.json(
    tickets.map((t) => ({
      ...t,
      orgId: t.project.orgId,
      project: { id: t.project.id, name: t.project.name },
    })),
  );
});

// --- In-app notification feed (global across orgs) ---
meRouter.get("/notifications", requireAuth, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    include: {
      ticket: {
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { name: true, orgId: true, org: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unread = notifications.filter((n) => !n.isRead).length;
  res.json({
    unread,
    notifications: notifications.map((n) => ({
      ...n,
      ticket: {
        id: n.ticket.id,
        title: n.ticket.title,
        projectId: n.ticket.projectId,
        orgId: n.ticket.project.orgId,
        orgName: n.ticket.project.org.name,
      },
    })),
  });
});

meRouter.post("/notifications/:id/read", requireAuth, async (req, res) => {
  // Scope by userId so a user can't mark someone else's notification read.
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user!.id },
    data: { isRead: true },
  });
  res.json({ ok: true });
});

meRouter.post("/notifications/read-all", requireAuth, async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, isRead: false },
    data: { isRead: true },
  });
  res.json({ ok: true });
});
