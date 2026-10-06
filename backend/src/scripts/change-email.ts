import "dotenv/config";
import { prisma } from "../prisma.js";

async function main() {
  const oldEmail = process.argv[2];
  const newEmail = process.argv[3];
  if (!oldEmail || !newEmail) {
    console.error("Usage: npx tsx src/scripts/change-email.ts <old-email> <new-email>");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email: newEmail.toLowerCase() } });
  if (existing) {
    console.error(`${newEmail} is already taken by another account.`);
    process.exit(1);
  }

  const current = await prisma.user.findUnique({ where: { email: oldEmail.toLowerCase() } });
  if (!current) {
    console.error(`No account found with email ${oldEmail}.`);
    process.exit(1);
  }

  const user = await prisma.user.update({
    where: { id: current.id },
    data: { email: newEmail.toLowerCase() },
  });
  console.log(`Renamed ${oldEmail} -> ${user.email} (id ${user.id}). Password and roles unchanged.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});