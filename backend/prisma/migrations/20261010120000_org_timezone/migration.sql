-- Organisation timezone: defines what "today" means for due-date views.
-- Additive only: one new column with a default, so every existing organisation
-- keeps working and no existing data is changed or removed.
ALTER TABLE "Organization" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';