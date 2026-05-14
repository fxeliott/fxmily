-- V2.0 TRACK module — habit logging (FXMILY-V2-MASTER plan A2-A5 must-have).
--
-- ADD-only migration (safe — no DROP, no rename, no backfill needed):
--   1. CREATE TYPE "HabitKind" — enum of 5 tracked habits.
--   2. CREATE TABLE "habit_logs" — one row per (user, date, kind).
--
-- Rollback (documented for `docs/runbook-hetzner-deploy.md` §11):
--   DROP TABLE "habit_logs";
--   DROP TYPE "HabitKind";
-- Production-safe at 30-member scale (<1s table lock per statement).

-- CreateEnum
CREATE TYPE "HabitKind" AS ENUM ('sleep', 'nutrition', 'caffeine', 'sport', 'meditation');

-- CreateTable
CREATE TABLE "habit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "HabitKind" NOT NULL,
    "value" JSONB NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "habit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "habit_logs_user_id_date_kind_key" ON "habit_logs"("user_id", "date", "kind");

-- CreateIndex
CREATE INDEX "habit_logs_user_id_date_idx" ON "habit_logs"("user_id", "date" DESC);

-- CreateIndex (per-kind aggregation : "show me my caffeine over the last 30 days")
CREATE INDEX "habit_logs_user_id_kind_date_idx" ON "habit_logs"("user_id", "kind", "date" DESC);

-- AddForeignKey
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
