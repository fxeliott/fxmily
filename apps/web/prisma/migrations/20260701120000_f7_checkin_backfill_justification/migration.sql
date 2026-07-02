-- F7 — check-in "rattrapage" (backfill) support. Two PURE additive nullable
-- columns on `daily_checkins`, mirror of `discrepancies.member_reason` /
-- `discrepancies.member_reason_at`:
--   * late_justification — member's free-text reason for a PAST-day fill.
--   * backfilled_at       — instant of the late fill (NULL for same-day rows).
-- Existing rows inherit NULL ("filled on time, no justification"), no backfill
-- needed, no DEFAULT transient dance (scalar nullable). Safe at any scale.
-- §2/§21.5: completion metadata + a self-report reason, never market content.
-- AlterTable
ALTER TABLE "daily_checkins" ADD COLUMN "late_justification" TEXT;
ALTER TABLE "daily_checkins" ADD COLUMN "backfilled_at" TIMESTAMP(3);
