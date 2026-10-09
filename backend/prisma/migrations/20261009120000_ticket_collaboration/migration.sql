-- Ticket collaboration: attachment visibility (Internal / Customer / Selected
-- Members), comment editing, activity timeline (append-only audit log),
-- followers and ticket archiving.
--
-- Data safety: no existing column is dropped. Attachment.visibility keeps its
-- values (INTERNAL / CLIENT_VISIBLE) when its type is widened, and the activity
-- log is back-filled from existing tickets and TicketStatusHistory so old
-- tickets don't start with an empty timeline.

-- CreateEnum
CREATE TYPE "AttachmentVisibility" AS ENUM ('INTERNAL', 'CLIENT_VISIBLE', 'SELECTED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('TICKET_CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'TYPE_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED', 'DUE_DATE_CHANGED', 'ASSIGNED', 'ATTACHMENT_ADDED', 'ATTACHMENT_DELETED', 'ATTACHMENT_VISIBILITY_CHANGED', 'COMMENT_ADDED', 'COMMENT_EDITED', 'COMMENT_DELETED', 'FOLLOWER_ADDED', 'FOLLOWER_REMOVED', 'MOVED', 'ARCHIVED', 'RESTORED', 'DUPLICATED');

-- AlterTable: widen Attachment.visibility, keeping every existing value
ALTER TABLE "Attachment" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "Attachment" ALTER COLUMN "visibility" TYPE "AttachmentVisibility" USING ("visibility"::text::"AttachmentVisibility");
ALTER TABLE "Attachment" ALTER COLUMN "visibility" SET DEFAULT 'CLIENT_VISIBLE';

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "editedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AttachmentAccess" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttachmentAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketActivity" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "field" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "meta" JSONB,
    "internalOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketFollower" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketFollower_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttachmentAccess_userId_idx" ON "AttachmentAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AttachmentAccess_attachmentId_userId_key" ON "AttachmentAccess"("attachmentId", "userId");

-- CreateIndex
CREATE INDEX "TicketActivity_ticketId_createdAt_idx" ON "TicketActivity"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketFollower_userId_idx" ON "TicketFollower"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketFollower_ticketId_userId_key" ON "TicketFollower"("ticketId", "userId");

-- CreateIndex
CREATE INDEX "Ticket_archivedAt_idx" ON "Ticket"("archivedAt");

-- AddForeignKey
ALTER TABLE "AttachmentAccess" ADD CONSTRAINT "AttachmentAccess_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttachmentAccess" ADD CONSTRAINT "AttachmentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketActivity" ADD CONSTRAINT "TicketActivity_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketActivity" ADD CONSTRAINT "TicketActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketFollower" ADD CONSTRAINT "TicketFollower_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketFollower" ADD CONSTRAINT "TicketFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketFollower" ADD CONSTRAINT "TicketFollower_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Back-fill: every existing ticket gets a "created" entry (by its reporter, at
-- its creation time) and every recorded status transition becomes an entry.
-- Ids are derived from the source row so re-running can't double-insert.
INSERT INTO "TicketActivity" ("id", "ticketId", "actorId", "type", "createdAt", "internalOnly")
SELECT 'act_c_' || t."id", t."id", t."reporterId", 'TICKET_CREATED', t."createdAt", false
FROM "Ticket" t
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "TicketActivity" ("id", "ticketId", "actorId", "type", "field", "fromValue", "toValue", "createdAt", "internalOnly")
SELECT 'act_s_' || h."id", h."ticketId", h."changedById", 'STATUS_CHANGED', 'status', h."fromStatus"::text, h."toStatus"::text, h."changedAt", false
FROM "TicketStatusHistory" h
ON CONFLICT ("id") DO NOTHING;

-- Audit protection: TicketActivity is append-only at the database level.
--  * UPDATE is always rejected.
--  * A DELETE issued directly is rejected; a DELETE that happens as the FK
--    cascade from deleting a ticket/project/org is allowed (trigger depth > 1).
CREATE FUNCTION "ticket_activity_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'TicketActivity is append-only: rows cannot be modified';
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'TicketActivity is append-only: rows cannot be deleted directly';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ticket_activity_append_only"
BEFORE UPDATE OR DELETE ON "TicketActivity"
FOR EACH ROW EXECUTE FUNCTION "ticket_activity_append_only"();

-- TRUNCATE skips row-level triggers, so it gets its own guard.
CREATE FUNCTION "ticket_activity_no_truncate"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TicketActivity is append-only: table cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ticket_activity_no_truncate"
BEFORE TRUNCATE ON "TicketActivity"
FOR EACH STATEMENT EXECUTE FUNCTION "ticket_activity_no_truncate"();