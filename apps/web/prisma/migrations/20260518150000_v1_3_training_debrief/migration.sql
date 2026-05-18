-- V1.3 — Débrief Training dédié (SPEC §23, jalon #1 de la séquence §21.6).
--
-- ONE change, ADD-only (safe — no DROP, no rename, no NOT-NULL-on-populated,
-- no backfill, no ALTER on a pre-existing/populated table):
--   1. CREATE TABLE "training_debriefs" — member-owned weekly backtest-practice
--      debrief (4 Steenbarger reverse-journaling free-text fields).
--   2. 1 regular index (user timeline) + 1 unique index (idempotency).
--   3. 1 FK "training_debriefs"->"users" ON DELETE CASCADE (RGPD §17 data
--      minimisation, consistent with the rest of the schema).
--
-- STATISTICAL-ISOLATION INVARIANT (SPEC §21.5 — BLOCKING product rule):
--   This migration touches ZERO real-edge object. There is NO foreign key to
--   "trades", "weekly_reviews" or "behavioral_scores"; the ONLY relation is
--   "training_debriefs"."user_id" -> "users"."id" (same shape as
--   "training_trades"). A debrief row can never reference a real trade or a
--   real-edge aggregate, so a future refactor of the real edge can never
--   reach the debrief, and the debrief can never leak into the real
--   track-record / score / expectancy / Habit×Trade correlation. The process
--   stats panel is computed at render from "training_trades" /
--   "training_annotations" and NEVER persists `result_r` / `outcome`.
--   Verified: the generated SQL below contains zero REFERENCES "trades",
--   zero REFERENCES "weekly_reviews", zero REFERENCES "behavioral_scores".
--
-- Rollback (to be transcribed into docs/runbook-hetzner-deploy.md §18 at
-- close-out — prior jalons §11..§17 followed the same separate-PR pattern;
-- this block is authoritative until then). Single brand-new + empty table at
-- V1.3 apply time, so an immediate rollback is loss-free; once members have
-- written debriefs, `pg_dump -t training_debriefs` BEFORE rollback is
-- mandatory (RGPD: member-authored reflective free-text). No "users" data is
-- touched (the FK is on the training_debriefs side only). One transaction:
--   BEGIN;
--   DROP TABLE IF EXISTS "training_debriefs";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260518150000_v1_3_training_debrief';
--   COMMIT;
-- Production-safe at 30-member scale (<1s table lock per statement).

-- CreateTable
CREATE TABLE "training_debriefs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "process_strength_one" TEXT NOT NULL,
    "process_strength_two" TEXT NOT NULL,
    "micro_adjustment" TEXT NOT NULL,
    "transversal_lesson" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_debriefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_debriefs_user_id_week_start_idx" ON "training_debriefs"("user_id", "week_start" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "training_debriefs_user_id_week_start_key" ON "training_debriefs"("user_id", "week_start");

-- AddForeignKey
ALTER TABLE "training_debriefs" ADD CONSTRAINT "training_debriefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
