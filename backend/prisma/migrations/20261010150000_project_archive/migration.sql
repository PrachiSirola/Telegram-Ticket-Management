-- Project archiving. Additive only: one nullable column, so every existing project
-- stays live (archivedAt IS NULL) and no data or relationship is touched.
ALTER TABLE "Project" ADD COLUMN "archivedAt" TIMESTAMP(3);