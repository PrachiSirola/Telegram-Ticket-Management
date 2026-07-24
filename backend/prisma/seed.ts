import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { hashPassword } from "../src/lib/password.js";

const prisma = new PrismaClient();

// Every seeded account uses this password (dev convenience — no dev-login).
const SEED_PASSWORD = "password123";

async function upsertUser(email: string, name: string, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name, passwordHash },
  });
}

async function main() {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  // --- Demo organisation ---
  const org = await prisma.organization.upsert({
    where: { id: "org_demo" },
    update: {},
    create: { id: "org_demo", name: "Steinn Labs" },
  });

  // --- Users (one per role) ---
  const sa = await upsertUser("owner@demo.test", "Olivia Owner", passwordHash);
  const admin = await upsertUser("admin@demo.test", "Aarav Admin", passwordHash);
  const dev = await upsertUser("dev@demo.test", "Dana Dev", passwordHash);
  const client = await upsertUser("client@demo.test", "Casey Client", passwordHash);

  const roles: Array<[string, "SUPER_ADMIN" | "ADMIN" | "DEVELOPER" | "CLIENT"]> = [
    [sa.id, "SUPER_ADMIN"],
    [admin.id, "ADMIN"],
    [dev.id, "DEVELOPER"],
    [client.id, "CLIENT"],
  ];
  const membershipByUser = new Map<string, string>();
  for (const [userId, role] of roles) {
    const m = await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId, orgId: org.id } },
      update: { role },
      create: { userId, orgId: org.id, role },
    });
    membershipByUser.set(userId, m.id);
  }

  // --- Projects ---
  const website = await prisma.project.upsert({
    where: { id: "proj_website" },
    update: {},
    create: { id: "proj_website", orgId: org.id, name: "Website Revamp", description: "Marketing site rebuild" },
  });
  const mobile = await prisma.project.upsert({
    where: { id: "proj_mobile" },
    update: {},
    create: { id: "proj_mobile", orgId: org.id, name: "Mobile App", description: "iOS/Android client app" },
  });

  // Client is attached to the Website project only.
  await prisma.projectClient.upsert({
    where: {
      projectId_membershipId: {
        projectId: website.id,
        membershipId: membershipByUser.get(client.id)!,
      },
    },
    update: {},
    create: { projectId: website.id, membershipId: membershipByUser.get(client.id)! },
  });

  // --- Sample tickets ---
  if ((await prisma.ticket.count()) === 0) {
    await prisma.ticket.create({
      data: {
        projectId: website.id,
        title: "Homepage hero renders blank on Safari",
        description: "Repro: open / in Safari 17. Hero section is empty.",
        status: "OPEN",
        priority: "HIGH",
        type: "BUG",
        reporterId: client.id,
        assigneeId: dev.id,
      },
    });
    await prisma.ticket.create({
      data: {
        projectId: website.id,
        title: "Add pricing page",
        description: "Three tiers with a comparison table.",
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        type: "FEATURE",
        reporterId: admin.id,
        assigneeId: dev.id,
      },
    });
    await prisma.ticket.create({
      data: {
        projectId: mobile.id,
        title: "Set up CI for the mobile repo",
        description: "Fastlane + GitHub Actions.",
        status: "OPEN",
        priority: "LOW",
        type: "TASK",
        reporterId: sa.id,
      },
    });
  }

  console.log("Seed complete — all accounts use password:", SEED_PASSWORD);
  console.log({
    org: org.name,
    superAdmin: sa.email,
    admin: admin.email,
    developer: dev.email,
    client: `${client.email} (attached to ${website.name})`,
    projects: [website.name, mobile.name],
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
