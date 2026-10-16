-- Authenticator app (TOTP) as an extra verification method next to the passkey PIN.
-- Additive only: new nullable / defaulted columns and one new table; no existing row changes.
ALTER TABLE "User"
    ADD COLUMN "totpSecretEnc" TEXT,
    ADD COLUMN "totpEnabledAt" TIMESTAMP(3),
    ADD COLUMN "totpPendingSecretEnc" TEXT,
    ADD COLUMN "totpPendingAt" TIMESTAMP(3),
    ADD COLUMN "totpLastStep" INTEGER,
    ADD COLUMN "totpAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "totpLockedUntil" TIMESTAMP(3);

-- Single-use recovery codes (keyed hashes only).
CREATE TABLE "BackupCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BackupCode_userId_codeHash_key" ON "BackupCode"("userId", "codeHash");
CREATE INDEX "BackupCode_userId_idx" ON "BackupCode"("userId");

ALTER TABLE "BackupCode" ADD CONSTRAINT "BackupCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
