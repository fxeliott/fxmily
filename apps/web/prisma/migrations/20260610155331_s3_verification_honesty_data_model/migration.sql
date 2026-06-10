-- S3 — Vérification & Honnêteté radicale data model (Session 1 Fondations,
-- data layer only — UI/pipeline/services land in the dedicated S3 session).
--
-- Purely ADDITIVE migration: 11 new enums + 9 new tables + 4 ADD COLUMN on
-- existing tables (trades / users / training_trades / mark_douglas_deliveries),
-- all nullable or SQL-DEFAULT'ed (`trades.source DEFAULT 'self_declared'`
-- backfills existing rows without a blocking table rewrite — Postgres 11+
-- fast-path). NO DROP, NO type change, NO data rewrite. Reversible by
-- dropping the new tables/types + the 4 columns.
--
-- Posture §2: `AlertCategory` is structurally single-valued (psychological)
-- — no trading-advice alert can exist by construction. Free-text columns
-- (`claude_reasoning`, `member_reason`) pass safeFreeText + §2/AMF + crisis
-- gates at the service boundary (S3 session).
--
-- NOTE: a pre-existing index-name drift on `notification_queue` (partial
-- index `notification_queue_pending_dispatch_idx` J9, custom name vs the
-- schema-declared `@@index([status, nextAttemptAt])`) is intentionally NOT
-- touched here (out of scope; flagged for a dedicated doc-hygiene jalon —
-- `prisma migrate dev` will keep proposing a RenameIndex until then).

-- CreateEnum
CREATE TYPE "BrokerAccountType" AS ENUM ('prop_firm', 'personal');

-- CreateEnum
CREATE TYPE "ProofOcrStatus" AS ENUM ('pending', 'done', 'failed');

-- CreateEnum
CREATE TYPE "ExtractedPositionSource" AS ENUM ('mt5_screen_ocr');

-- CreateEnum
CREATE TYPE "TradeSource" AS ENUM ('self_declared', 'mt5_verified');

-- CreateEnum
CREATE TYPE "TradeMatchStatus" AS ENUM ('unmatched', 'matched', 'mismatch');

-- CreateEnum
CREATE TYPE "DiscrepancyType" AS ENUM ('missing_declared', 'false_declared', 'mismatch', 'unfilled_no_reason');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "ScoreEventReason" AS ENUM ('filled', 'forgot_no_reason', 'reality_gap', 'false_declaration');

-- CreateEnum
CREATE TYPE "AlertCategory" AS ENUM ('psychological');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('open', 'delivered', 'dismissed');

-- CreateEnum
CREATE TYPE "TradeMediaKind" AS ENUM ('entry', 'exit', 'other');

-- AlterTable
ALTER TABLE "mark_douglas_deliveries" ADD COLUMN     "source_alert_id" TEXT;

-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "match_status" "TradeMatchStatus",
ADD COLUMN     "source" "TradeSource" NOT NULL DEFAULT 'self_declared',
ADD COLUMN     "verified_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "training_trades" ADD COLUMN     "session_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "detected_account_count" INTEGER;

-- CreateTable
CREATE TABLE "broker_accounts" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "BrokerAccountType" NOT NULL,
    "broker_name" TEXT,
    "detected_by_ai" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broker_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mt5_account_proofs" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "broker_account_id" TEXT,
    "file_key" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "account_type" "BrokerAccountType",
    "ocr_status" "ProofOcrStatus" NOT NULL DEFAULT 'pending',
    "claude_run_id" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mt5_account_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_positions" (
    "id" TEXT NOT NULL,
    "broker_account_id" TEXT NOT NULL,
    "proof_id" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "TradeDirection" NOT NULL,
    "open_time" TIMESTAMP(3) NOT NULL,
    "close_time" TIMESTAMP(3),
    "volume" DECIMAL(12,4) NOT NULL,
    "entry_price" DECIMAL(20,8),
    "exit_price" DECIMAL(20,8),
    "pnl" DECIMAL(14,2),
    "source" "ExtractedPositionSource" NOT NULL DEFAULT 'mt5_screen_ocr',
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discrepancies" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "type" "DiscrepancyType" NOT NULL,
    "declared_trade_id" TEXT,
    "extracted_position_id" TEXT,
    "severity" INTEGER NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'open',
    "claude_reasoning" TEXT,
    "member_reason" TEXT,
    "member_reason_at" TIMESTAMP(3),
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "constancy_scores" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "constancy_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_events" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "reason" "ScoreEventReason" NOT NULL,
    "related_discrepancy_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "repeat_count" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "category" "AlertCategory" NOT NULL DEFAULT 'psychological',
    "status" "AlertStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_media" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "kind" "TradeMediaKind" NOT NULL DEFAULT 'entry',
    "file_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_sessions" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "label" TEXT,
    "symbol" TEXT,
    "timeframe" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broker_accounts_member_id_idx" ON "broker_accounts"("member_id");

-- CreateIndex
CREATE INDEX "mt5_account_proofs_member_id_uploaded_at_idx" ON "mt5_account_proofs"("member_id", "uploaded_at" DESC);

-- CreateIndex
CREATE INDEX "mt5_account_proofs_ocr_status_uploaded_at_idx" ON "mt5_account_proofs"("ocr_status", "uploaded_at");

-- CreateIndex
CREATE UNIQUE INDEX "mt5_account_proofs_member_id_file_hash_key" ON "mt5_account_proofs"("member_id", "file_hash");

-- CreateIndex
CREATE INDEX "extracted_positions_broker_account_id_open_time_idx" ON "extracted_positions"("broker_account_id", "open_time");

-- CreateIndex
CREATE INDEX "discrepancies_member_id_status_idx" ON "discrepancies"("member_id", "status");

-- CreateIndex
CREATE INDEX "discrepancies_member_id_detected_at_idx" ON "discrepancies"("member_id", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "constancy_scores_member_id_computed_at_idx" ON "constancy_scores"("member_id", "computed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "constancy_scores_member_id_period_start_key" ON "constancy_scores"("member_id", "period_start");

-- CreateIndex
CREATE INDEX "score_events_member_id_created_at_idx" ON "score_events"("member_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_member_id_status_idx" ON "alerts"("member_id", "status");

-- CreateIndex
CREATE INDEX "trade_media_trade_id_idx" ON "trade_media"("trade_id");

-- CreateIndex
CREATE INDEX "training_sessions_member_id_started_at_idx" ON "training_sessions"("member_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "training_trades" ADD CONSTRAINT "training_trades_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "training_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_douglas_deliveries" ADD CONSTRAINT "mark_douglas_deliveries_source_alert_id_fkey" FOREIGN KEY ("source_alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_accounts" ADD CONSTRAINT "broker_accounts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mt5_account_proofs" ADD CONSTRAINT "mt5_account_proofs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mt5_account_proofs" ADD CONSTRAINT "mt5_account_proofs_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_positions" ADD CONSTRAINT "extracted_positions_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_positions" ADD CONSTRAINT "extracted_positions_proof_id_fkey" FOREIGN KEY ("proof_id") REFERENCES "mt5_account_proofs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_declared_trade_id_fkey" FOREIGN KEY ("declared_trade_id") REFERENCES "trades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_extracted_position_id_fkey" FOREIGN KEY ("extracted_position_id") REFERENCES "extracted_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constancy_scores" ADD CONSTRAINT "constancy_scores_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_related_discrepancy_id_fkey" FOREIGN KEY ("related_discrepancy_id") REFERENCES "discrepancies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_media" ADD CONSTRAINT "trade_media_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
