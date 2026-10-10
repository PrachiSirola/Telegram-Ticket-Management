import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireOrgRole } from "../middleware/org.js";
import { isOrgSA } from "../lib/access.js";
import { isAllowedEmailDomain } from "../lib/password.js";
import { inviteEmail, sendEmail, type SendResult } from "../lib/email.js";
import type { Invite } from "@prisma/client";

/** Email the invite link to the invitee. Never throws (sendEmail swallows). */
async function sendInviteEmail(invite: Invite, inviterName: string): Promise<SendResult> {
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
  return sendEmail({ ...mail, to: invite.email });
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

    if (!isAllowedEmailDomain(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

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

// ---------------------------------------------------------------------------
// Bulk invite. One role per batch; each recipient has their own project list
// (the UI fills the same list for everyone in "same projects" mode). Every
// recipient gets their own Invite row + unique token, so acceptance, expiry and
// revoke work exactly like single invites. Per-recipient problems never abort
// the batch — the response reports each address.
// ---------------------------------------------------------------------------
export const BULK_INVITE_MAX = 50;

const bulkSchema = z.object({
  role: z.enum(["ADMIN", "DEVELOPER", "CLIENT"]),
  items: z
    .array(z.object({ email: z.string(), projectIds: z.array(z.string()).optional() }))
    .min(1, "Add at least one email")
    .max(BULK_INVITE_MAX, `You can invite up to ${BULK_INVITE_MAX} people at a time`),
});

type BulkStatus = "invited" | "skipped" | "invalid";
interface BulkResult {
  email: string;
  status: BulkStatus;
  /** Why it was skipped / rejected (or the email error when the mail didn't go out). */
  reason?: string;
  /** invited only: did the email actually go out? The invite exists either way. */
  emailSent?: boolean;
  inviteUrl?: string;
}

invitesRouter.post(
  "/bulk",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(400).json({ error: first?.message ?? "Invalid request" });
    }
    const orgId = req.params.orgId;
    const { role, items } = parsed.data;

    // Same rule as single invite: only the org's Super Admin may invite Admins.
    if (role === "ADMIN" && !isOrgSA(req.user!, orgId)) {
      return res.status(403).json({ error: "Only the Super Admin can invite Admins" });
    }

    // Normalise, then split into rows we'll try vs. rows we can already reject.
    const results = new Map<number, BulkResult>();
    const seen = new Set<string>();
    const candidates: { idx: number; email: string; projectIds: string[] }[] = [];
    items.forEach((it, idx) => {
      const email = it.email.trim().toLowerCase();
      if (!z.string().email().safeParse(email).success || !isAllowedEmailDomain(email)) {
        results.set(idx, { email: it.email.trim(), status: "invalid", reason: "Not a valid email address" });
      } else if (seen.has(email)) {
        results.set(idx, { email, status: "skipped", reason: "Duplicate in this list" });
      } else {
        seen.add(email);
        candidates.push({ idx, email, projectIds: [...new Set(it.projectIds ?? [])] });
      }
    });

    const emails = candidates.map((c) => c.email);
    const [users, pendingInvites] = await Promise.all([
      prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true, memberships: { where: { orgId }, select: { id: true } } },
      }),
      prisma.invite.findMany({
        where: { orgId, email: { in: emails }, status: "PENDING", expiresAt: { gt: new Date() } },
        select: { email: true },
      }),
    ]);
    const memberEmails = new Set(users.filter((u) => u.memberships.length > 0).map((u) => u.email.toLowerCase()));
    const pendingEmails = new Set(pendingInvites.map((i) => i.email.toLowerCase()));

    // Validate every referenced project belongs to THIS org in one query.
    const wantedProjects = [...new Set(candidates.flatMap((c) => (role === "ADMIN" ? [] : c.projectIds)))];
    const validProjects = new Set(
      wantedProjects.length
        ? (await prisma.project.findMany({ where: { id: { in: wantedProjects }, orgId }, select: { id: true } })).map(
            (p) => p.id,
          )
        : [],
    );

    const inviterName = req.user!.name;
    for (const c of candidates) {
      if (memberEmails.has(c.email)) {
        results.set(c.idx, { email: c.email, status: "skipped", reason: "Already a member of this organisation" });
        continue;
      }
      if (pendingEmails.has(c.email)) {
        results.set(c.idx, { email: c.email, status: "skipped", reason: "Already has a pending invite" });
        continue;
      }
      const projectIds = role === "ADMIN" ? [] : c.projectIds;
      if (role === "CLIENT" && projectIds.length === 0) {
        results.set(c.idx, { email: c.email, status: "invalid", reason: "Clients need at least one project" });
        continue;
      }
      if (projectIds.some((id) => !validProjects.has(id))) {
        results.set(c.idx, { email: c.email, status: "invalid", reason: "One or more projects don't exist in this org" });
        continue;
      }

      try {
        const invite = await prisma.invite.create({
          data: {
            email: c.email,
            role,
            projectIds,
            orgId,
            token: randomUUID(),
            invitedById: req.user!.id,
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days, same as single invite
          },
        });
        // Sequential on purpose: gentle on the mail provider's rate limits, and a
        // mail failure keeps the invite (link still shown) instead of losing it.
        const sent = await sendInviteEmail(invite, inviterName);
        results.set(c.idx, {
          email: c.email,
          status: "invited",
          emailSent: sent.ok,
          ...(sent.ok ? {} : { reason: sent.error ?? "Email could not be sent" }),
          inviteUrl: `${env.frontendUrl}/accept-invite?token=${invite.token}`,
        });
      } catch (e) {
        console.error("[invites/bulk] could not create invite for", c.email, e);
        results.set(c.idx, { email: c.email, status: "invalid", reason: "Could not create the invite" });
      }
    }

    const ordered = items.map((_, i) => results.get(i)!);
    res.status(200).json({
      results: ordered,
      summary: {
        total: ordered.length,
        invited: ordered.filter((r) => r.status === "invited").length,
        emailFailed: ordered.filter((r) => r.status === "invited" && !r.emailSent).length,
        skipped: ordered.filter((r) => r.status === "skipped").length,
        invalid: ordered.filter((r) => r.status === "invalid").length,
      },
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