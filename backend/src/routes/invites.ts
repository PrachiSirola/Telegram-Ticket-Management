import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import type { Invite } from "../db/types.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireOrgRole } from "../middleware/org.js";
import { isOrgSA } from "../lib/access.js";
import { isAllowedEmailDomain } from "../lib/password.js";
import { inviteEmail, sendEmail, type SendResult } from "../lib/email.js";

async function sendInviteEmail(invite: Invite, inviterName: string): Promise<SendResult> {
  const [org, projects] = await Promise.all([
    db.orgs.mustById(invite.orgId),
    invite.projectIds.length
      ? db.projects.find({ _id: { $in: invite.projectIds }, orgId: invite.orgId })
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

export const invitesRouter = Router({ mergeParams: true });

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "DEVELOPER", "CLIENT"]),
  projectIds: z.array(z.string()).optional(),
});

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

    const existingUser = await db.users.findOne({ email });
    if (existingUser) {
      const member = await db.memberships.findOne({ userId: existingUser.id, orgId });
      if (member) return res.status(409).json({ error: "This email is already a member" });
    }
    let projectIds: string[] = [];
    if (role === "CLIENT") {
      projectIds = [...new Set(parsed.data.projectIds ?? [])];
      if (projectIds.length === 0) {
        return res.status(400).json({ error: "Client invites need at least one project" });
      }
      const found = await db.projects.find({ _id: { $in: projectIds }, orgId }, { select: ["id"] });
      if (found.length !== projectIds.length) {
        return res.status(400).json({ error: "One or more projects don't exist in this org" });
      }
    } else if (role === "DEVELOPER") {
      projectIds = [...new Set(parsed.data.projectIds ?? [])];
      if (projectIds.length > 0) {
        const found = await db.projects.find({ _id: { $in: projectIds }, orgId }, { select: ["id"] });
        if (found.length !== projectIds.length) {
          return res.status(400).json({ error: "One or more projects don't exist in this org" });
        }
      }
    }

    const invite = await db.invites.create({
      email,
      role,
      projectIds,
      orgId,
      token: randomUUID(),
      invitedById: req.user!.id,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });

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
  reason?: string;
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

    if (role === "ADMIN" && !isOrgSA(req.user!, orgId)) {
      return res.status(403).json({ error: "Only the Super Admin can invite Admins" });
    }

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
      db.users.find({ email: { $in: emails } }),
      db.invites.find({ orgId, email: { $in: emails }, status: "PENDING", expiresAt: { $gt: new Date() } }),
    ]);
    const memberUserIds = new Set(
      users.length ? await db.memberships.distinct("userId", { orgId, userId: { $in: users.map((u) => u.id) } }) : [],
    );
    const memberEmails = new Set(users.filter((u) => memberUserIds.has(u.id)).map((u) => u.email.toLowerCase()));
    const pendingEmails = new Set(pendingInvites.map((i) => i.email.toLowerCase()));

    const wantedProjects = [...new Set(candidates.flatMap((c) => (role === "ADMIN" ? [] : c.projectIds)))];
    const validProjects = new Set(
      wantedProjects.length
        ? (await db.projects.find({ _id: { $in: wantedProjects }, orgId }, { select: ["id"] })).map((p) => p.id)
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
        const invite = await db.invites.create({
          email: c.email,
          role,
          projectIds,
          orgId,
          token: randomUUID(),
          invitedById: req.user!.id,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days, same as single invite
        });
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
invitesRouter.get(
  "/",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const invites = await db.invites.find({ orgId: req.params.orgId }, { sort: { createdAt: -1, _id: -1 } });
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
invitesRouter.post(
  "/:inviteId/resend",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const invite = await db.invites.byId(req.params.inviteId);
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

invitesRouter.delete(
  "/:inviteId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const invite = await db.invites.byId(req.params.inviteId);
    if (!invite || invite.orgId !== req.params.orgId) {
      return res.status(404).json({ error: "Invite not found" });
    }
    await db.invites.deleteOne({ _id: invite.id });
    res.json({ ok: true });
  },
);