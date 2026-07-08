-- Leaderboard (discipline/effort ranking) — schema for the /classement feature.
--
--   users.avatar_key          : member profile-photo storage key (avatars/{uid}/…)
--   users.leaderboard_opt_out : RGPD visibility control (hide own row from others)
--   MemberModerationAction    : +avatar_removed (admin photo takedown audit trail)
--   leaderboard_snapshots     : nightly per-(member, day) ranking snapshot
--
-- Additive-only: a new nullable column, a new column with a NOT NULL default
-- (safe to add on a populated table — existing rows get `false`), an idempotent
-- enum value, and a brand-new table. No data backfill needed: the nightly
-- `recompute-leaderboard` cron (crontab.fxmily:75) populates the snapshots.

-- AlterEnum: additive + idempotent (PG 12+). The value is NOT used elsewhere in
-- this migration, so it composes cleanly inside the wrapped transaction.
ALTER TYPE "MemberModerationAction" ADD VALUE IF NOT EXISTS 'avatar_removed';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_key" TEXT,
ADD COLUMN     "leaderboard_opt_out" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "leaderboard_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "score" INTEGER,
    "rank" INTEGER,
    "components" JSONB NOT NULL,
    "sample_size" JSONB NOT NULL,
    "window_days" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leaderboard_snapshots_date_rank_idx" ON "leaderboard_snapshots"("date", "rank");

-- CreateIndex
CREATE INDEX "leaderboard_snapshots_user_id_date_idx" ON "leaderboard_snapshots"("user_id", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_snapshots_user_id_date_key" ON "leaderboard_snapshots"("user_id", "date");

-- AddForeignKey
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
