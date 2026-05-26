-- =============================================================================
-- V2.3 — Pre-trade circuit breaker (Session BB, ADR-003)
-- =============================================================================
--
-- Migration ADD-only (safe at 30-member scale, no ALTER on existing tables):
--   - 2 new enums (PreTradeReason, PreTradeEmotion)
--   - 1 new table (pre_trade_checks) with FK→users CASCADE
--   - 1 index (user_id, created_at DESC) for service-layer reads
--
-- Lock duration estimate at 30 members: <1s.
-- Risk: LOW.
--
-- ROLLBACK (pattern carbone V1.3/V1.4/V1.5/T5 — see runbook §17→§21) :
--   pg_dump --schema-only --table=pre_trade_checks ... > backup_pre_v2_3.sql
--   docker stop fxmily-web
--   BEGIN;
--   DROP TABLE "pre_trade_checks";  -- cascade-removes the FK
--   DROP TYPE "PreTradeEmotion";
--   DROP TYPE "PreTradeReason";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260526100000_v2_3_pre_trade_check';
--   COMMIT;
--   -- redeploy pre-V2.3 image, verify /api/health 200, audit.users.deletedAt
--
-- NB: order matters — table BEFORE types (Postgres rejects type drop while
-- column references it). See T5/§14 V2.0 rollback recipes for canonical pattern.
-- =============================================================================

-- CreateEnum
CREATE TYPE "PreTradeReason" AS ENUM ('edge', 'fomo', 'revenge', 'boredom');

-- CreateEnum
CREATE TYPE "PreTradeEmotion" AS ENUM ('calme', 'excite', 'frustre', 'anxieux');

-- CreateTable
CREATE TABLE "pre_trade_checks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason_to_trade" "PreTradeReason" NOT NULL,
    "emotion_label" "PreTradeEmotion" NOT NULL,
    "plan_alignment" BOOLEAN NOT NULL,
    "stop_loss_predefined" BOOLEAN NOT NULL,
    "linked_trade_id" TEXT,

    CONSTRAINT "pre_trade_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pre_trade_checks_user_id_created_at_idx" ON "pre_trade_checks"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "pre_trade_checks" ADD CONSTRAINT "pre_trade_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
