import "dotenv/config";
import { connectDb, db, disconnectDb } from "../db/index.js";

async function main() {
  await connectDb();
  const oldEmail = process.argv[2];
  const newEmail = process.argv[3];
  if (!oldEmail || !newEmail) {
    console.error("Usage: npx tsx src/scripts/change-email.ts <old-email> <new-email>");
    process.exit(1);
  }

  const existing = await db.users.findOne({ email: newEmail.toLowerCase() });
  if (existing) {
    console.error(`${newEmail} is already taken by another account.`);
    process.exit(1);
  }

  const current = await db.users.findOne({ email: oldEmail.toLowerCase() });
  if (!current) {
    console.error(`No account found with email ${oldEmail}.`);
    process.exit(1);
  }

  const user = await db.users.mustUpdate({ _id: current.id }, { email: newEmail.toLowerCase() });
  console.log(`Renamed ${oldEmail} -> ${user.email} (id ${user.id}). Password and roles unchanged.`);
  await disconnectDb();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});