-- SPEC §28/§22 — evening "bilan" self-report: did the member study / make
-- progress in Eliot's COURSE (la formation) today? Pure additive nullable
-- Boolean (mirror of `market_analysis_done` / `morning_routine_completed`):
-- existing rows inherit NULL ("unanswered/legacy"), no backfill needed, no
-- DEFAULT transient dance (scalar nullable, not an array). Safe at any scale.
-- SPEC §2 posture: tracks THAT the member studied, never the content.
-- AlterTable
ALTER TABLE "daily_checkins" ADD COLUMN "formation_followed" BOOLEAN;
