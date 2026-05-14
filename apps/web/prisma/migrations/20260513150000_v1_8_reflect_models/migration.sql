-- V1.8 REFLECT — member-facing reflection module.
--
-- Three changes, all ADD-only (safe — no DROP, no rename, no default backfill
-- needed beyond `trades.tags DEFAULT '{}'`):
--   1. CREATE TABLE "weekly_reviews" — member-owned Sunday recap.
--   2. CREATE TABLE "reflection_entries" — CBT Ellis ABCD daily reflections.
--   3. ALTER TABLE "trades" ADD COLUMN "tags" TEXT[] — post-outcome bias tags.
--
-- Rollback (documented for `docs/runbook-hetzner-deploy.md` §11):
--   ALTER TABLE "trades" DROP COLUMN "tags";
--   DROP TABLE "reflection_entries";
--   DROP TABLE "weekly_reviews";
-- Production-safe at 30-member scale (<1s table lock per statement).

-- CreateTable
CREATE TABLE "weekly_reviews" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "biggest_win" TEXT NOT NULL,
    "biggest_mistake" TEXT NOT NULL,
    "best_practice" TEXT,
    "lesson_learned" TEXT NOT NULL,
    "next_week_focus" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reflection_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "trigger_event" TEXT NOT NULL,
    "belief_auto" TEXT NOT NULL,
    "consequence" TEXT NOT NULL,
    "disputation" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reflection_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weekly_reviews_user_id_week_start_idx" ON "weekly_reviews"("user_id", "week_start" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_reviews_user_id_week_start_key" ON "weekly_reviews"("user_id", "week_start");

-- CreateIndex
CREATE INDEX "reflection_entries_user_id_date_idx" ON "reflection_entries"("user_id", "date" DESC);

-- AddForeignKey
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection_entries" ADD CONSTRAINT "reflection_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
-- V1.8 Trade.tags — Postgres TEXT[] (array). Allowlist enforced at Zod boundary
-- (`TRADE_TAG_SLUGS` in `lib/schemas/trade.ts`), DB stays open-text to keep
-- migrations free as slug list evolves. Defaults to empty array so V1 trades
-- pre-V1.8 stay valid without backfill.
ALTER TABLE "trades" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
