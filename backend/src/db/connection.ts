import mongoose, { type ClientSession } from "mongoose";
import { env } from "../env.js";

let transactional = false;

export const transactionsEnabled = () => transactional;

export async function connectDb(uri = env.mongoUri): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15_000,
    maxPoolSize: Number(process.env.MONGO_POOL_SIZE) || 20,
    ...(env.mongoDbName ? { dbName: env.mongoDbName } : {}),
  });

  const hello = await mongoose.connection.db!.admin().command({ isMaster: 1 });
  const supported = Boolean(hello.setName || hello.msg === "isdbgrid") && (hello.maxWireVersion ?? 0) >= 7;
  const mode = env.mongoTransactions;
  if (mode === "on" && !supported) {
    await mongoose.disconnect();
    throw new Error(
      "MONGO_TRANSACTIONS=on but this MongoDB deployment can't run transactions (needs a replica set on MongoDB 4.0+).",
    );
  }
  transactional = mode === "off" ? false : supported;
  if (!transactional && env.nodeEnv !== "test") {
    console.warn(
      "[db] Transactions are OFF (standalone MongoDB, an old server, or MONGO_TRANSACTIONS=off). " +
        "Multi-step writes will not be atomic. Use a replica set (e.g. MongoDB Atlas) in production.",
    );
  }


  const { allModels } = await import("./models.js");
  await Promise.all(allModels.map((m) => m.init()));
  return mongoose;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}


export async function withTransaction<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!transactional) return fn(undefined);
  return mongoose.connection.transaction(fn as (s: ClientSession) => Promise<T>, {
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
    maxCommitTimeMS: 20_000,
  }) as Promise<T>;
}

export type { ClientSession };
