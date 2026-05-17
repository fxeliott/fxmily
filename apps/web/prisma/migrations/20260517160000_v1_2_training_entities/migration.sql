-- V1.2 — Mode Entraînement / Backtest TradingView training entities (SPEC §21).
--
-- ADD-only migration (safe — no DROP, no rename, no NOT-NULL-on-populated, no
-- backfill, no ALTER on a pre-existing/populated table):
--   1. CREATE TYPE "TrainingOutcome"             — backtest result enum.
--   2. CREATE TYPE "TrainingAnnotationMediaType" — admin-correction media enum.
--   3. CREATE TABLE "training_trades"            — member backtest entry.
--   4. CREATE TABLE "training_annotations"       — admin correction (J4 mirror).
--   5. 4 indexes (training-trade feed + 3 annotation feeds).
--   6. 3 FKs (training_trades->users, training_annotations->training_trades,
--      training_annotations->users) ALL ON DELETE CASCADE (RGPD data
--      minimisation, consistent with the rest of the schema).
--
-- STATISTICAL-ISOLATION INVARIANT (SPEC §21.2/§21.5 — BLOCKING product rule):
--   This migration touches ZERO real-edge object. There is NO foreign key to
--   "trades", and "TrainingOutcome"/"TrainingAnnotationMediaType" are SEPARATE
--   Postgres enums from "TradeOutcome"/"AnnotationMediaType" (same values,
--   deliberately distinct types). A training row can never reference a real
--   trade or a real enum, so a future refactor of the real edge can never
--   reach training, and training results can never leak into the real
--   track-record / score / expectancy / Habit×Trade correlation. Verified:
--   the generated SQL below contains zero REFERENCES "trades" and zero
--   "TradeOutcome" / "AnnotationMediaType" token.
--
-- Rollback (to be transcribed into docs/runbook-hetzner-deploy.md §16 at
-- close-out — prior jalons §12/§13/§14/§15 followed the same separate-PR
-- pattern; this block is authoritative until then). MANDATORY ORDER: the
-- annotations table (child, FK -> training_trades) BEFORE training_trades,
-- THEN the enum types (Postgres rejects a type drop while a column still
-- references it), THEN the _prisma_migrations row, all inside one transaction:
--   BEGIN;
--   DROP TABLE IF EXISTS "training_annotations";
--   DROP TABLE IF EXISTS "training_trades";
--   DROP TYPE IF EXISTS "TrainingAnnotationMediaType";
--   DROP TYPE IF EXISTS "TrainingOutcome";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260517160000_v1_2_training_entities';
--   COMMIT;
-- Both tables are brand-new + empty at V1.2 apply time, so an immediate
-- rollback is loss-free; once members have logged backtests,
-- pg_dump -t training_trades -t training_annotations BEFORE rollback is
-- mandatory (RGPD: member-authored backtest data + admin corrections).
-- No "users" data is touched (the FKs are on the training_* side only).
-- Production-safe at 30-member scale (<1s table lock per statement).

-- CreateEnum
CREATE TYPE "TrainingOutcome" AS ENUM ('win', 'loss', 'break_even');

-- CreateEnum
CREATE TYPE "TrainingAnnotationMediaType" AS ENUM ('image', 'video');

-- CreateTable
CREATE TABLE "training_trades" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "entry_screenshot_key" TEXT,
    "planned_rr" DECIMAL(6,2) NOT NULL,
    "outcome" "TrainingOutcome",
    "result_r" DECIMAL(6,2),
    "system_respected" BOOLEAN,
    "lesson_learned" TEXT NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_annotations" (
    "id" TEXT NOT NULL,
    "training_trade_id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "media_key" TEXT,
    "media_type" "TrainingAnnotationMediaType",
    "seen_by_member_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_trades_user_id_entered_at_idx" ON "training_trades"("user_id", "entered_at" DESC);

-- CreateIndex
CREATE INDEX "training_annotations_training_trade_id_created_at_idx" ON "training_annotations"("training_trade_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "training_annotations_training_trade_id_seen_by_member_at_idx" ON "training_annotations"("training_trade_id", "seen_by_member_at");

-- CreateIndex
CREATE INDEX "training_annotations_admin_id_created_at_idx" ON "training_annotations"("admin_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "training_trades" ADD CONSTRAINT "training_trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_annotations" ADD CONSTRAINT "training_annotations_training_trade_id_fkey" FOREIGN KEY ("training_trade_id") REFERENCES "training_trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_annotations" ADD CONSTRAINT "training_annotations_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

