/**
 * One-off CLI to designate (or reinstate) the single fixed platform Super
 * Admin — the only account allowed to create new organisations. Run this
 * once for your own existing account (created back when public signup was
 * still open); there's no UI for this on purpose — it's meant to be a rare,
 * manual, out-of-band action.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/set-platform-admin.ts you@gmail.com
 *
 * Pass a second argument "off" to deactivate instead:
 *   npx tsx src/scripts/set-platform-admin.ts you@gmail.com off
 */
import "dotenv/config";
import { prisma } from "../prisma.js";

async function main() {
  const email = process.argv[2];
  const mode = process.argv[3];
  if (!email) {
    console.error("Usage: npx tsx src/scripts/set-platform-admin.ts <email> [off]");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.error(`No account found for ${email}. They need to have an existing account first.`);
    process.exit(1);
  }

  if (mode === "off") {
    await prisma.user.update({
      where: { id: user.id },
      data: { platformAdminActive: false },
    });
    console.log(`Deactivated platform admin access for ${user.email}.`);
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { platformRole: "SUPER_ADMIN", platformAdminActive: true },
    });
    console.log(`${user.email} is now the platform Super Admin (can create organisations).`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});