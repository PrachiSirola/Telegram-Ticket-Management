import "dotenv/config";
import { allModels, connectDb, disconnectDb } from "../db/index.js";
async function main() {
  await connectDb();
  for (const m of allModels) {
    const dropped = await m.syncIndexes();
    console.log(`${m.collection.collectionName}: indexes in sync${dropped.length ? ` (dropped ${dropped.join(", ")})` : ""}`);
  }
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
