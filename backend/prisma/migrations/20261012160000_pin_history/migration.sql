-- CreateTable: archive of previous PIN hashes (bcrypt), mirrors "PasswordHistory".
-- Additive only: no existing table or row is touched. Existing users simply start
-- with an empty archive; their current PIN ("User"."pinHash") is always checked too.
CREATE TABLE "PinHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PinHistory_userId_createdAt_idx" ON "PinHistory"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PinHistory" ADD CONSTRAINT "PinHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;