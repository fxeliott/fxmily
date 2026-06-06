-- SPEC §28/§22 — pre-session "market analysis done?" discipline declaration.
-- Pure additive nullable Boolean (mirror of `morning_routine_completed`):
-- existing rows inherit NULL ("unanswered/legacy"), no backfill needed, no
-- DEFAULT transient dance (scalar nullable, not an array). Safe at any scale.
-- AlterTable
ALTER TABLE "daily_checkins" ADD COLUMN "market_analysis_done" BOOLEAN;
