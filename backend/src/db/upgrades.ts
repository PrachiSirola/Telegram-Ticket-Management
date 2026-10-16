import mongoose from "mongoose";
import { db } from "./models.js";
export async function upgradeLegacyAssignees(): Promise<{ converted: number; left: number }> {
  const coll = db.tickets.model.collection;
  const legacy = { assigneeId: { $exists: true }, assigneeIds: { $exists: false } };
  let converted = 0;
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
    converted += res.modifiedCount;
    if (res.modifiedCount === 0) break; 
  }
  const left = await coll.countDocuments({ assigneeId: { $exists: true } });
  return { converted, left };
}

export async function runStartupUpgrades() {
  const a = await upgradeLegacyAssignees();
  if (a.converted) console.log(`[db] Upgraded ${a.converted} ticket(s) to multiple assignees.`);
  if (a.left) console.warn(`[db] ${a.left} ticket(s) still have the old assigneeId field.`);
}

export const dbName = () => mongoose.connection.name;
export const dbHost = () => mongoose.connection.host;
