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