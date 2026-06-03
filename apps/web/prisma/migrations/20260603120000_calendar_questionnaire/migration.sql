-- §26 Calendrier adaptatif J-C1 — ADD-only (2 enums + 2 tables, safe 30 membres). Rollback: docs/runbook-hetzner-deploy.md §24.
-- =============================================================================
-- §26 — Calendrier personnel adaptatif (J-C1 data layer, 2026-06-03)
-- =============================================================================
--
-- Migration ADD-only (safe at 30-member scale, no ALTER on existing tables):
--   - 2 new enums :
--     * CalendarSlot (morning/afternoon/evening)
--     * CalendarBlockCategory (live_trading/backtest/mark_douglas_review/
--       checkin/rest/meeting/free)
--   - 2 new tables :
--     * weekly_schedule_questionnaires (cascade users, idempotent userId×weekStart)
--     * adaptive_calendars (cascade users, idempotent userId×weekStart)
--   - 5 indexes (2 UNIQUE composite userId×week_start ; 3 INDEX:
--     2× userId×week_start DESC + 1× generated_at DESC)
--   - 2 foreign keys ON DELETE CASCADE (RGPD §17 data-minimisation)
--
-- Pattern carbone V2.4 (`20260527170000_v2_4_onboarding_interview`) + V1.4
-- monthly-debrief + V1.5 mindset-check. Posture §2 / §21.5 / §27.7 BLOQUANT :
-- the calendar organises TIME of practice (sessions/backtest/Mark Douglas/
-- réunions §30/rest), NEVER trades. ZERO P&L column. ZERO FK to trades / scores.
-- AdaptiveCalendar has NO FK to WeeklyScheduleQuestionnaire (snapshot-at-
-- generation decoupling — the calendar persists calendar_instrument_version
-- to record which questionnaire instrument fed it).
--
-- Lock duration estimate at 30 members: <1s.
-- Risk: LOW (no ALTER on existing tables, no data backfill, 2 ADD tables empty
-- at deploy time = no member can have a row yet, both FKs reference the existing
-- users table only). Enum order: CalendarSlot + CalendarBlockCategory are
-- emitted BEFORE the CREATE TABLE that uses them (energy_peak_slot /
-- primary_category) — required by Postgres.
--
-- ROLLBACK (pattern carbone V1.3/V1.4/V1.5/V2.3/V2.4 — full procedure runbook §24) :
--   docker stop fxmily-web
--   BEGIN;
--   DROP TABLE "adaptive_calendars";              -- cascade-removes 1 FK
--   DROP TABLE "weekly_schedule_questionnaires";  -- cascade-removes 1 FK
--   DROP TYPE "CalendarBlockCategory";            -- safe after table drops
--   DROP TYPE "CalendarSlot";                     -- safe after table drops
--   DELETE FROM "_prisma_migrations"
--     WHERE "migration_name" = '20260603120000_calendar_questionnaire';
--   COMMIT;
--   -- redeploy pre-§26 image, verify /api/health 200
--
-- NB: drop order = tables first (adaptive_calendars then questionnaires) ->
-- enums. Postgres rejects type drop while a column references it.
--
-- POSTURE §2 RAPPEL : V1 questionnaire = ZERO free-text (closed Likert, carbone
-- MindsetCheck §27) -> no safeFreeText / crisis-detection surface at this layer.
-- The AdaptiveCalendar `schedule` JSON is the Claude batch-local output,
-- validated by `adaptiveCalendarOutputSchema` `.strict()` BEFORE INSERT.
-- =============================================================================

-- CreateEnum
CREATE TYPE "CalendarSlot" AS ENUM ('morning', 'afternoon', 'evening');

-- CreateEnum
CREATE TYPE "CalendarBlockCategory" AS ENUM ('live_trading', 'backtest', 'mark_douglas_review', 'checkin', 'rest', 'meeting', 'free');

-- CreateTable
CREATE TABLE "weekly_schedule_questionnaires" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "instrument_version" INTEGER NOT NULL,
    "energy_peak_slot" "CalendarSlot" NOT NULL,
    "responses" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_schedule_questionnaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adaptive_calendars" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "schedule" JSONB NOT NULL,
    "primary_category" "CalendarBlockCategory",
    "claude_model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_eur" DECIMAL(10,6) NOT NULL,
    "ai_disclosure_shown_at" TIMESTAMP(3),
    "calendar_instrument_version" INTEGER NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adaptive_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weekly_schedule_questionnaires_user_id_week_start_idx" ON "weekly_schedule_questionnaires"("user_id", "week_start" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_schedule_questionnaires_user_id_week_start_key" ON "weekly_schedule_questionnaires"("user_id", "week_start");

-- CreateIndex
CREATE INDEX "adaptive_calendars_user_id_week_start_idx" ON "adaptive_calendars"("user_id", "week_start" DESC);

-- CreateIndex
CREATE INDEX "adaptive_calendars_generated_at_idx" ON "adaptive_calendars"("generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "adaptive_calendars_user_id_week_start_key" ON "adaptive_calendars"("user_id", "week_start");

-- AddForeignKey
ALTER TABLE "weekly_schedule_questionnaires" ADD CONSTRAINT "weekly_schedule_questionnaires_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adaptive_calendars" ADD CONSTRAINT "adaptive_calendars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
