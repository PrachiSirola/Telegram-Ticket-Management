-- CreateTable
CREATE TABLE "PinResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PinResetToken_tokenHash_key" ON "PinResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PinResetToken_userId_idx" ON "PinResetToken"("userId");

-- AddForeignKey
ALTER TABLE "PinResetToken" ADD CONSTRAINT "PinResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
