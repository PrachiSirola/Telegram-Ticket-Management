import "dotenv/config";
import { connectDb, db, disconnectDb } from "../db/index.js";
import { hashPassword } from "../lib/password.js";

const SEED_PASSWORD = "password123";

async function upsertUser(email: string, name: string, passwordHash: string) {
  return db.users.upsert({ email }, { name }, { email, passwordHash });
}

async function main() {
  await connectDb();
  const passwordHash = await hashPassword(SEED_PASSWORD);


  const org = await db.orgs.upsert({ _id: "org_demo" }, {}, { name: "Steinn Labs" });


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
    const m = await db.memberships.upsert({ userId, orgId: org.id }, { role }, { userId, orgId: org.id });
    membershipByUser.set(userId, m.id);
  }

  const website = await db.projects.upsert(
    { _id: "proj_website" },
    {},
    { orgId: org.id, name: "Website Revamp", description: "Marketing site rebuild" },
  );
  const mobile = await db.projects.upsert(
    { _id: "proj_mobile" },
    {},
    { orgId: org.id, name: "Mobile App", description: "iOS/Android client app" },
  );

  const clientMembershipId = membershipByUser.get(client.id)!;
  await db.projectClients.upsert(
    { projectId: website.id, membershipId: clientMembershipId },
    {},
    { projectId: website.id, membershipId: clientMembershipId },
  );

  if ((await db.tickets.count()) === 0) {
    await db.tickets.createMany([
      {
        projectId: website.id,
        title: "Homepage hero renders blank on Safari",
        description: "Repro: open / in Safari 17. Hero section is empty.",
        status: "OPEN",
        priority: "HIGH",
        type: "BUG",
        reporterId: client.id,
        assigneeIds: [dev.id],
      },
      {
        projectId: website.id,
        title: "Add pricing page",
        description: "Three tiers with a comparison table.",
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        type: "FEATURE",
        reporterId: admin.id,
        assigneeIds: [dev.id],
      },
      {
        projectId: mobile.id,
        title: "Set up CI for the mobile repo",
        description: "Fastlane + GitHub Actions.",
        status: "OPEN",
        priority: "LOW",
        type: "TASK",
        reporterId: sa.id,
      },
    ]);
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
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
