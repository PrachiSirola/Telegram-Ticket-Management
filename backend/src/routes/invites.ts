import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireOrgRole } from "../middleware/org.js";
import { isOrgSA } from "../lib/access.js";
import { inviteEmail, sendEmail } from "../lib/email.js";
import type { Invite } from "@prisma/client";

/** Email the invite link to the invitee. Never throws (sendEmail swallows). */
async function sendInviteEmail(invite: Invite, inviterName: string) {
  const [org, projects] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: invite.orgId },
      select: { name: true },
    }),
    invite.projectIds.length
      ? prisma.project.findMany({
          where: { id: { in: invite.projectIds }, orgId: invite.orgId },
          select: { name: true },
        })
      : Promise.resolve([]),
  ]);
  const mail = inviteEmail({
    orgName: org.name,
    inviterName,
    role: invite.role,
    projectNames: projects.map((p) => p.name),
    inviteUrl: `${env.frontendUrl}/accept-invite?token=${invite.token}`,
  });
  await sendEmail({ ...mail, to: invite.email });
}

// mergeParams so :orgId from the parent mount is available.
export const invitesRouter = Router({ mergeParams: true });

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "DEVELOPER", "CLIENT"]),
  projectIds: z.array(z.string()).optional(),
});

// Create an invite. SA may invite any role; Admins only Developers/Clients.
// CLIENT invites must name at least one project (of this org) to attach.
invitesRouter.post(
  "/",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const orgId = req.params.orgId;
    const email = parsed.data.email.toLowerCase();
    const { role } = parsed.data;

    if (role === "ADMIN" && !isOrgSA(req.user!, orgId)) {
      return res.status(403).json({ error: "Only the Super Admin can invite Admins" });
    }

    // Already an active member of this org?
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const member = await prisma.orgMembership.findUnique({
        where: { userId_orgId: { userId: existingUser.id, orgId } },
      });
      if (member) return res.status(409).json({ error: "This email is already a member" });
    }

    // Clients must be attached to at least one project of THIS org.
    // Developers may optionally be pre-attached to projects too (not
    // required — a developer can also gain access later via ticket
    // assignment, see lib/projectAccess.ts), but any ids they do provide
    // still need to be validated the same way.
    let projectIds: string[] = [];
    if (role === "CLIENT") {
      projectIds = [...new Set(parsed.data.projectIds ?? [])];
      if (projectIds.length === 0) {
        return res.status(400).json({ error: "Client invites need at least one project" });
      }
      const found = await prisma.project.findMany({
        where: { id: { in: projectIds }, orgId },
        select: { id: true },
      });
      if (found.length !== projectIds.length) {
        return res.status(400).json({ error: "One or more projects don't exist in this org" });
      }
    } else if (role === "DEVELOPER") {
      projectIds = [...new Set(parsed.data.projectIds ?? [])];
      if (projectIds.length > 0) {
        const found = await prisma.project.findMany({
          where: { id: { in: projectIds }, orgId },
          select: { id: true },
        });
        if (found.length !== projectIds.length) {
          return res.status(400).json({ error: "One or more projects don't exist in this org" });
        }
      }
    }

    const invite = await prisma.invite.create({
      data: {
        email,
        role,
        projectIds,
        orgId,
        token: randomUUID(),
        invitedById: req.user!.id,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
      },
    });

    // Email the link to the invitee, AND return it for manual sharing (belt
    // and suspenders — email can be slow or land in spam).
    await sendInviteEmail(invite, req.user!.name);

    res.status(201).json({
      id: invite.id,
      email,
      role: invite.role,
      status: invite.status,
      inviteUrl: `${env.frontendUrl}/accept-invite?token=${invite.token}`,
    });
  },
);

// List invites for the org. SA/Admin only.
invitesRouter.get(
  "/",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const invites = await prisma.invite.findMany({
      where: { orgId: req.params.orgId },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        projectIds: i.projectIds,
        expiresAt: i.expiresAt,
        inviteUrl: i.status === "PENDING" ? `${env.frontendUrl}/accept-invite?token=${i.token}` : null,
      })),
    );
  },
);

// Re-send the invite email for a pending invite.
invitesRouter.post(
  "/:inviteId/resend",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const invite = await prisma.invite.findUnique({ where: { id: req.params.inviteId } });
    if (!invite || invite.orgId !== req.params.orgId || invite.status !== "PENDING") {
      return res.status(404).json({ error: "Invite not found" });
    }
    if (invite.expiresAt < new Date()) {
      return res.status(400).json({ error: "This invite has expired — create a new one" });
    }
    await sendInviteEmail(invite, req.user!.name);
    res.json({ ok: true });
  },
);

// Revoke a pending invite.
invitesRouter.delete(
  "/:inviteId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const invite = await prisma.invite.findUnique({ where: { id: req.params.inviteId } });
    if (!invite || invite.orgId !== req.params.orgId) {
      return res.status(404).json({ error: "Invite not found" });
    }
    await prisma.invite.delete({ where: { id: invite.id } });
    res.json({ ok: true });
  },
);