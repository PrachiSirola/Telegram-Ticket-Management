import "dotenv/config";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";
import { allModels, connectDb, db, disconnectDb } from "../db/index.js";
import { env } from "../env.js";
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const VERIFY_ONLY = args.has("--verify-only");
const BATCH = 1000;

const REQ = Symbol("required");
type Spec = {
  table: string;
  coll: () => import("mongodb").Collection<any>;
  fields: Record<string, unknown>;
  refs?: Record<string, string>;
  derive?: (row: Record<string, any>) => Record<string, any>;
};
const c = (m: { model: { collection: any } }) => () => m.model.collection;

const SPECS: Spec[] = [
  {
    table: "User", coll: c(db.users),
    fields: {
      email: REQ, name: REQ, passwordHash: REQ, avatarUrl: null, platformRole: null, platformAdminActive: true,
      twoFactorEnabled: false, twoFactorMethod: null, pinHash: null, pinAttempts: 0, pinLockedUntil: null,
      totpSecretEnc: null, totpEnabledAt: null, totpPendingSecretEnc: null, totpPendingAt: null, totpLastStep: null,
      totpAttempts: 0, totpLockedUntil: null, createdAt: REQ, updatedAt: REQ,
    },
  },
  {
    table: "Organization", coll: c(db.orgs),
    fields: { name: REQ, telegramBotToken: null, telegramChatId: null, timezone: "Asia/Kolkata", createdAt: REQ, updatedAt: REQ },
  },
  {
    table: "OrgMembership", coll: c(db.memberships),
    fields: { userId: REQ, orgId: REQ, role: REQ, disabled: false, createdAt: REQ },
    refs: { userId: "User", orgId: "Organization" },
  },
  {
    table: "Project", coll: c(db.projects),
    fields: { orgId: REQ, name: REQ, description: "", archivedAt: null, createdAt: REQ, updatedAt: REQ },
    refs: { orgId: "Organization" },
  },
  {
    table: "ProjectClient", coll: c(db.projectClients),
    fields: { projectId: REQ, membershipId: REQ, createdAt: REQ },
    refs: { projectId: "Project", membershipId: "OrgMembership" },
  },
  {
    table: "ProjectDeveloper", coll: c(db.projectDevelopers),
    fields: { projectId: REQ, membershipId: REQ, createdAt: REQ },
    refs: { projectId: "Project", membershipId: "OrgMembership" },
  },
  {
    table: "Invite", coll: c(db.invites),
    fields: { email: REQ, orgId: REQ, role: REQ, projectIds: [], token: REQ, status: "PENDING", invitedById: REQ, expiresAt: REQ, createdAt: REQ },
    refs: { orgId: "Organization", invitedById: "User" },
  },
  {
    table: "PendingSignup", coll: c(db.pendingSignups),
    fields: { email: REQ, orgName: REQ, name: REQ, passwordHash: REQ, codeHash: REQ, attempts: 0, expiresAt: REQ, createdAt: REQ },
  },
  {
    table: "PasswordResetToken", coll: c(db.passwordResets),
    fields: { userId: REQ, tokenHash: REQ, expiresAt: REQ, usedAt: null, createdAt: REQ },
    refs: { userId: "User" },
  },
  {
    table: "PinResetToken", coll: c(db.pinResets),
    fields: { userId: REQ, tokenHash: REQ, expiresAt: REQ, usedAt: null, createdAt: REQ },
    refs: { userId: "User" },
  },
  {
    table: "OrgCreationRequest", coll: c(db.orgCreations),
    fields: { requestedById: REQ, orgName: REQ, tokenHash: REQ, expiresAt: REQ, verifiedAt: null, createdOrgId: null, createdAt: REQ },
    refs: { requestedById: "User" },
  },
  {
    table: "PasswordHistory", coll: c(db.passwordHistory),
    fields: { userId: REQ, passwordHash: REQ, createdAt: REQ }, refs: { userId: "User" },
  },
  {
    table: "PinHistory", coll: c(db.pinHistory),
    fields: { userId: REQ, pinHash: REQ, createdAt: REQ }, refs: { userId: "User" },
  },
  {
    table: "Ticket", coll: c(db.tickets),
    fields: {
      projectId: REQ, title: REQ, description: "", status: "OPEN", priority: "MEDIUM", type: "TASK",
      reporterId: REQ, dueDate: null, estimate: null, archivedAt: null, createdAt: REQ, updatedAt: REQ,
    },
    refs: { projectId: "Project", assigneeIds: "User", reporterId: "User" },
    derive: (r) => ({ assigneeIds: r.assigneeId ? [r.assigneeId] : [] }),
  },
  {
    table: "TicketActivity", coll: c(db.activity),
    fields: {
      ticketId: REQ, actorId: REQ, type: REQ, field: null, fromValue: null, toValue: null, meta: null,
      internalOnly: false, createdAt: REQ,
    },
    refs: { ticketId: "Ticket", actorId: "User" },
  },
  {
    table: "TicketFollower", coll: c(db.followers),
    fields: { ticketId: REQ, userId: REQ, addedById: REQ, createdAt: REQ },
    refs: { ticketId: "Ticket", userId: "User", addedById: "User" },
  },
  {
    table: "TicketStatusHistory", coll: c(db.statusHistory),
    fields: { ticketId: REQ, fromStatus: null, toStatus: REQ, changedById: REQ, changedAt: REQ },
    refs: { ticketId: "Ticket", changedById: "User" },
  },
  {
    table: "Comment", coll: c(db.comments),
    fields: { ticketId: REQ, authorId: REQ, parentId: null, body: REQ, visibility: "INTERNAL", editedAt: null, createdAt: REQ },
    refs: { ticketId: "Ticket", authorId: "User", parentId: "Comment" },
  },
  {
    table: "Attachment", coll: c(db.attachments),
    fields: {
      ticketId: REQ, commentId: null, uploaderId: REQ, filename: REQ, mimeType: REQ, size: REQ, storageKey: REQ,
      visibility: "CLIENT_VISIBLE", createdAt: REQ,
    },
    refs: { ticketId: "Ticket", commentId: "Comment", uploaderId: "User" },
  },
  {
    table: "AttachmentAccess", coll: c(db.attachmentAccess),
    fields: { attachmentId: REQ, userId: REQ, createdAt: REQ }, refs: { attachmentId: "Attachment", userId: "User" },
  },
  {
    table: "Notification", coll: c(db.notifications),
    fields: { userId: REQ, type: REQ, ticketId: REQ, isRead: false, payload: null, createdAt: REQ },
    refs: { userId: "User", ticketId: "Ticket" },
  },
];

pg.types.setTypeParser(1114, (s: string) => new Date(s.replace(" ", "T") + "Z"));

function toDoc(spec: Spec, row: Record<string, any>) {
  const doc: Record<string, any> = { _id: row.id };
  for (const [col, dflt] of Object.entries(spec.fields)) {
    const v = row[col];
    if (v === undefined) {
      if (dflt === REQ) throw new Error(`${spec.table}.${col} is missing in PostgreSQL (id ${row.id})`);
      doc[col] = dflt;
    } else doc[col] = v;
  }
  if (spec.derive) Object.assign(doc, spec.derive(row));
  return doc;
}

function canon(v: any): string {
  if (v instanceof Date) return JSON.stringify({ $d: v.toISOString() });
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }
  return JSON.stringify(v === undefined ? null : v);
}
const fp = (doc: Record<string, any>) => createHash("sha1").update(canon(doc)).digest("hex");
const sum64 = (acc: bigint, hex: string) => (acc + BigInt("0x" + hex.slice(0, 16))) & 0xffffffffffffffffn;

async function tableExists(client: pg.PoolClient, table: string) {
  const r = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`"${table}"`]);
  return Boolean(r.rows[0].ok);
}

async function* readTable(client: pg.PoolClient, table: string) {
  let last: string | null = null;
  for (;;) {
    const r: pg.QueryResult = last === null
      ? await client.query(`SELECT * FROM "${table}" ORDER BY "id" COLLATE "C" LIMIT ${BATCH}`)
      : await client.query(`SELECT * FROM "${table}" WHERE "id" COLLATE "C" > $1 ORDER BY "id" COLLATE "C" LIMIT ${BATCH}`, [last]);
    if (r.rows.length === 0) return;
    yield r.rows;
    last = r.rows[r.rows.length - 1].id;
  }
}

interface TableReport {
  table: string; pgRows: number | null; mongoRows: number; copied: number; fingerprintOk: boolean;
  missingInMongo: string[]; differing: string[]; extraInMongo: number; skipped?: string;
}

async function main() {
  const pgUrl = process.env.DATABASE_URL;
  if (!pgUrl) throw new Error("Set DATABASE_URL to the OLD PostgreSQL connection string.");
  const pool = new pg.Pool({ connectionString: pgUrl, max: 2 });
  await connectDb(env.mongoUri);
  const client = await pool.connect();
  const started = new Date();
  const reports: TableReport[] = [];
  const problems: string[] = [];

  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    console.log(`Source: PostgreSQL (read-only snapshot)   Target: MongoDB ${DRY ? "(dry run - nothing is written)" : VERIFY_ONLY ? "(verify only)" : ""}`);

    if (!DRY && !VERIFY_ONLY) await Promise.all(allModels.map((m) => m.init()));

    const pgIds = new Map<string, Set<string>>();

    for (const spec of SPECS) {
      const rep: TableReport = {
        table: spec.table, pgRows: null, mongoRows: 0, copied: 0, fingerprintOk: true,
        missingInMongo: [], differing: [], extraInMongo: 0,
      };
      reports.push(rep);
      if (!(await tableExists(client, spec.table))) {
        rep.skipped = "table not in PostgreSQL";
        console.log(`- ${spec.table}: not found in PostgreSQL, skipped`);
        pgIds.set(spec.table, new Set());
        continue;
      }
      const coll = spec.coll();
      const ids = new Set<string>();
      pgIds.set(spec.table, ids);
      let pgCount = 0, pgDigest = 0n;
      const pgFp = new Map<string, string>();

      for await (const rows of readTable(client, spec.table)) {
        const docs = rows.map((r) => toDoc(spec, r));
        for (const d of docs) {
          ids.add(d._id);
          const h = fp(d);
          pgFp.set(d._id, h);
          pgDigest = sum64(pgDigest, h);
        }
        pgCount += docs.length;
        if (!DRY && !VERIFY_ONLY) {
          const res = await coll.bulkWrite(
            docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
            { ordered: false },
          );
          rep.copied += res.upsertedCount + res.modifiedCount + res.matchedCount - res.modifiedCount;
        }
      }
      rep.pgRows = pgCount;


      const mongoFp = new Map<string, string>();
      let mongoDigest = 0n;
      for await (const d of coll.find({}, { batchSize: BATCH })) {
        const h = fp(d);
        mongoFp.set(String(d._id), h);
        mongoDigest = sum64(mongoDigest, h);
      }
      rep.mongoRows = mongoFp.size;
      if (DRY) {
        console.log(`- ${spec.table}: ${pgCount} rows in PostgreSQL, ${mongoFp.size} already in MongoDB`);
        continue;
      }
      for (const [id, h] of pgFp) {
        const m = mongoFp.get(id);
        if (m === undefined) rep.missingInMongo.push(id);
        else if (m !== h) rep.differing.push(id);
      }
      rep.extraInMongo = [...mongoFp.keys()].filter((id) => !pgFp.has(id)).length;
      rep.fingerprintOk = rep.missingInMongo.length === 0 && rep.differing.length === 0;
      const countOk = rep.mongoRows >= pgCount && rep.extraInMongo === 0 ? rep.mongoRows === pgCount : false;
      const ok = rep.fingerprintOk && countOk && (rep.extraInMongo === 0);
      if (!ok) {
        problems.push(
          `${spec.table}: PostgreSQL ${pgCount} / MongoDB ${rep.mongoRows}; missing ${rep.missingInMongo.length}, ` +
            `different ${rep.differing.length}, extra in MongoDB ${rep.extraInMongo}`,
        );
      }
      console.log(
        `${ok ? "OK  " : "FAIL"} ${spec.table.padEnd(20)} postgres=${String(pgCount).padStart(7)} mongo=${String(rep.mongoRows).padStart(7)}` +
          `  digest ${pgDigest === mongoDigest ? "match" : "DIFFERENT"}`,
      );
    }

    if (DRY) {
      console.log("\nDry run complete. Nothing was written.");
      return;
    }

    console.log("\nReference check:");
    let orphanTotal = 0;
    for (const spec of SPECS) {
      for (const [col, target] of Object.entries(spec.refs ?? {})) {
        const targetIds = new Set<string>();
        for await (const d of SPECS.find((s) => s.table === target)!.coll().find({}, { projection: { _id: 1 } })) targetIds.add(String(d._id));
        let orphans = 0;
        for await (const d of spec.coll().find({ [col]: { $ne: null } }, { projection: { [col]: 1 } })) {
          for (const ref of [d[col]].flat()) if (!targetIds.has(String(ref))) orphans++;
        }
        if (orphans) {
          orphanTotal += orphans;
          problems.push(`${spec.table}.${col} -> ${target}: ${orphans} orphaned reference(s)`);
          console.log(`FAIL ${spec.table}.${col} -> ${target}: ${orphans} orphan(s)`);
        }
      }
    }
    if (!orphanTotal) console.log("OK   no orphaned references");

    const sa = await db.memberships.aggregate<{ _id: string; n: number }>([
      { $match: { role: "SUPER_ADMIN" } },
      { $group: { _id: "$orgId", n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]);
    if (sa.length) problems.push(`${sa.length} organisation(s) have more than one Super Admin`);
    console.log(sa.length ? `FAIL ${sa.length} org(s) with several Super Admins` : "OK   exactly one Super Admin per organisation");

    const result = problems.length === 0 ? "PASSED" : "FAILED";
    const reportFile = `migration-report-${started.toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(reportFile, JSON.stringify({ startedAt: started, finishedAt: new Date(), result, problems, tables: reports }, null, 2));
    console.log(`\nVerification ${result}. Report written to ${reportFile}`);
    if (problems.length) {
      for (const p of problems) console.log("  - " + p);
      process.exitCode = 1;
    } else {
      console.log("PostgreSQL was not modified. Keep it until you've tested the app on MongoDB, then follow MONGODB_MIGRATION.md to remove it.");
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message ?? err);
  process.exit(1);
});
