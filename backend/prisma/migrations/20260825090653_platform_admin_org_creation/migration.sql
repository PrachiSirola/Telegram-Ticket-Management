-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "platformAdminActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "platformRole" "PlatformRole";

-- CreateTable
CREATE TABLE "OrgCreationRequest" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgCreationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgCreationRequest_tokenHash_key" ON "OrgCreationRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "OrgCreationRequest_requestedById_idx" ON "OrgCreationRequest"("requestedById");

-- AddForeignKey
ALTER TABLE "OrgCreationRequest" ADD CONSTRAINT "OrgCreationRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
