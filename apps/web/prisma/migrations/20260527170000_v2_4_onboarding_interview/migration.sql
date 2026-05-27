-- =============================================================================
-- V2.4 — Onboarding interview profilage IA (Session α, M3 directive 2026-05-27)
-- =============================================================================
--
-- Migration ADD-only (safe at 30-member scale, no ALTER on existing tables):
--   - 1 new enum (InterviewStatus: started/in_progress/completed/abandoned)
--   - 3 new tables :
--     * onboarding_interviews (1-1 cascade users)
--     * onboarding_interview_answers (cascade interview + cascade user)
--     * member_profiles (1-1 cascade users + 1-1 RESTRICT to interview)
--   - 6 indexes (3 UNIQUE: 2× user_id + 1× interview_id ; 2 INDEX: status×completed_at
--     + user_id×created_at DESC ; 1 UNIQUE composite: interview_id×question_index)
--   - 5 foreign keys with explicit ON DELETE behavior
--
-- Pattern carbone V2.3 (`20260526100000_v2_3_pre_trade_check`) + V1.4 monthly-debrief
-- + V1.5 mindset-check. Posture §2 strict — service layer enforces no-trade-advice
-- regex on Claude outputs (claude-client.ts post-gen filter, Phase A.2 future).
--
-- Lock duration estimate at 30 members: <1s.
-- Risk: LOW (no ALTER on existing tables, no data backfill, 3 ADD tables empty
-- at deploy time = no member can have a row yet, all FKs reference existing
-- users table only).
--
-- ROLLBACK (pattern carbone V1.3/V1.4/V1.5/V2.3 — see runbook §17→§22) :
--   docker stop fxmily-web
--   BEGIN;
--   DROP TABLE "member_profiles";                            -- cascade-removes 2 FKs
--   DROP TABLE "onboarding_interview_answers";               -- cascade-removes 2 FKs
--   DROP TABLE "onboarding_interviews";                      -- cascade-removes 1 FK
--   DROP TYPE "InterviewStatus";                             -- safe after table drops
--   DELETE FROM "_prisma_migrations"
--     WHERE "migration_name" = '20260527170000_v2_4_onboarding_interview';
--   COMMIT;
--   -- redeploy pre-V2.4 image, verify /api/health 200
--
-- NB: drop order = leaves first (member_profiles) → answers → interviews → enum.
-- Postgres rejects type drop while column references it. See T5/§14 V2.0 rollback
-- recipes for canonical pattern.
--
-- POSTURE §2 RAPPEL : ce schéma stocke des reponses libres safeFreeText (answer_text)
-- soumises par le membre. Sanitization + crisis-detection AVANT INSERT au service
-- layer (carbone V1.8 REFLECT pattern `reflection.submitted` audit slug).
-- =============================================================================

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('started', 'in_progress', 'completed', 'abandoned');

-- CreateTable
CREATE TABLE "onboarding_interviews" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'started',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "claude_model_version" TEXT,
    "total_tokens_input" INTEGER NOT NULL DEFAULT 0,
    "total_tokens_output" INTEGER NOT NULL DEFAULT 0,
    "instrument_version" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_interview_answers" (
    "id" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question_index" INTEGER NOT NULL,
    "question_key" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "answer_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_interview_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "highlights" JSONB NOT NULL,
    "axes_prioritaires" JSONB NOT NULL,
    "claude_model_version" TEXT NOT NULL,
    "instrument_version" TEXT NOT NULL,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_interviews_user_id_key" ON "onboarding_interviews"("user_id");

-- CreateIndex
CREATE INDEX "onboarding_interviews_status_completed_at_idx" ON "onboarding_interviews"("status", "completed_at");

-- CreateIndex
CREATE INDEX "onboarding_interview_answers_user_id_created_at_idx" ON "onboarding_interview_answers"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_interview_answers_interview_id_question_index_key" ON "onboarding_interview_answers"("interview_id", "question_index");

-- CreateIndex
CREATE UNIQUE INDEX "member_profiles_user_id_key" ON "member_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_profiles_interview_id_key" ON "member_profiles"("interview_id");

-- AddForeignKey
ALTER TABLE "onboarding_interviews" ADD CONSTRAINT "onboarding_interviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_interview_answers" ADD CONSTRAINT "onboarding_interview_answers_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "onboarding_interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_interview_answers" ADD CONSTRAINT "onboarding_interview_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "onboarding_interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
