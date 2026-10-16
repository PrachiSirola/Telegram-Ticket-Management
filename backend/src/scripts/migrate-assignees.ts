import "dotenv/config";
import { connectDb, db, disconnectDb } from "../db/index.js";
import { env } from "../env.js";

const DRY = process.argv.includes("--dry-run");

async function main() {
  await connectDb(env.mongoUri);
  const coll = db.tickets.model.collection;
  const legacy = { assigneeId: { $exists: true }, assigneeIds: { $exists: false } };

  const total = await coll.countDocuments({});
  const toConvert = await coll.countDocuments(legacy);
  const withAssignee = await coll.countDocuments({ ...legacy, assigneeId: { $nin: [null, ""] } });
  console.log(`Tickets: ${total}. Still on the old format: ${toConvert} (${withAssignee} with an assignee).`);

  if (!DRY && toConvert) {
    let done = 0;
    for (;;) {
      const batch = await coll.find(legacy, { projection: { assigneeId: 1 } }).limit(500).toArray();
      if (!batch.length) break;
      const res = await coll.bulkWrite(
        batch.map((d: any) => ({
          updateOne: {
            filter: { _id: d._id, assigneeIds: { $exists: false } },
            update: { $set: { assigneeIds: d.assigneeId ? [String(d.assigneeId)] : [] }, $unset: { assigneeId: "" } },
          },
        })),
        { ordered: false },
      );
      done += res.modifiedCount;
    }
    console.log(`Converted ${done} ticket(s).`);
  }

  const left = await coll.countDocuments({ assigneeId: { $exists: true } });
  const userIds = new Set((await db.users.distinct("_id")).map(String));
  let orphans = 0;
  for await (const t of coll.find({ assigneeIds: { $exists: true, $ne: [] } }, { projection: { assigneeIds: 1 } })) {
    for (const id of t.assigneeIds as string[]) if (!userIds.has(String(id))) orphans++;
  }
  const withIds = await coll.countDocuments({ assigneeIds: { $exists: true, $ne: [] } });
  console.log(`Tickets with assignees now: ${withIds}. Old-format tickets left: ${left}. Assignees that are not users: ${orphans}.`);
  if (!DRY && (left || orphans)) {
    console.log("FAILED: see the counts above.");
    process.exitCode = 1;
  } else console.log(DRY ? "Dry run complete. Nothing was written." : "OK");
  await disconnectDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
