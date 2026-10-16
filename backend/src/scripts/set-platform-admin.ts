import "dotenv/config";
import { connectDb, db, disconnectDb } from "../db/index.js";

async function main() {
  await connectDb();
  const email = process.argv[2];
  const mode = process.argv[3];
  if (!email) {
    console.error("Usage: npx tsx src/scripts/set-platform-admin.ts <email> [off]");
    process.exit(1);
  }

  const user = await db.users.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error(`No account found for ${email}. They need to have an existing account first.`);
    process.exit(1);
  }

  if (mode === "off") {
    await db.users.mustUpdate({ _id: user.id }, { platformAdminActive: false });
    console.log(`Deactivated platform admin access for ${user.email}.`);
  } else {
    await db.users.mustUpdate({ _id: user.id }, { platformRole: "SUPER_ADMIN", platformAdminActive: true });
    console.log(`${user.email} is now the platform Super Admin (can create organisations).`);
  }
  await disconnectDb();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});