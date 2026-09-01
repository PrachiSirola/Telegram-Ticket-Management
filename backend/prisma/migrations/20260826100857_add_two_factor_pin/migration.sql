-- CreateEnum
CREATE TYPE "TwoFactorMethod" AS ENUM ('PIN', 'PASSKEY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3),
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorMethod" "TwoFactorMethod";
