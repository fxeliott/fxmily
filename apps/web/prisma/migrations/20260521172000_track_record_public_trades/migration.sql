-- Track-record T0 (2026-05-21) — Public-facing Eliott + Fxmily trade showcase.
-- Table dediee, isolee du Journal membre (table `trades`). Audit log slug
-- `track_record.*` reservation pour T2 admin CRUD.

-- CreateEnum
CREATE TYPE "PublicTradeSegment" AS ENUM ('historical', 'live');

-- CreateEnum
CREATE TYPE "PublicTradeStatus" AS ENUM ('open', 'closed', 'break_even');

-- CreateTable
CREATE TABLE "public_trades" (
    "id" TEXT NOT NULL,
    "segment" "PublicTradeSegment" NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "instrument" TEXT NOT NULL,
    "direction" "TradeDirection",
    "entered_at" TIMESTAMP(3) NOT NULL,
    "exited_at" TIMESTAMP(3),
    "risk_percent" DECIMAL(4,2) NOT NULL,
    "result_r" DECIMAL(6,3),
    "result_percent" DECIMAL(6,3),
    "status" "PublicTradeStatus" NOT NULL,
    "session" "TradeSession",
    "setup" TEXT,
    "tags" TEXT[],
    "notes" TEXT,
    "screenshot_url" TEXT,
    "source" TEXT NOT NULL DEFAULT 'import',
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_trades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_trades_ordinal_key" ON "public_trades"("ordinal");

-- CreateIndex
CREATE INDEX "public_trades_segment_entered_at_idx" ON "public_trades"("segment", "entered_at" DESC);

-- CreateIndex
CREATE INDEX "public_trades_is_published_entered_at_idx" ON "public_trades"("is_published", "entered_at" DESC);

-- CreateIndex
CREATE INDEX "public_trades_instrument_idx" ON "public_trades"("instrument");

-- CreateTable
CREATE TABLE "public_trade_partials" (
    "id" TEXT NOT NULL,
    "public_trade_id" TEXT NOT NULL,
    "closed_at_r" DECIMAL(6,3) NOT NULL,
    "closed_percent" DECIMAL(5,2) NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_trade_partials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_trade_partials_public_trade_id_closed_at_idx" ON "public_trade_partials"("public_trade_id", "closed_at" ASC);

-- AddForeignKey
ALTER TABLE "public_trade_partials" ADD CONSTRAINT "public_trade_partials_public_trade_id_fkey" FOREIGN KEY ("public_trade_id") REFERENCES "public_trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rollback recipe (manual, NOT auto-run by Prisma) :
--   DROP TABLE "public_trade_partials" CASCADE;
--   DROP TABLE "public_trades" CASCADE;
--   DROP TYPE "PublicTradeStatus";
--   DROP TYPE "PublicTradeSegment";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260521172000_track_record_public_trades';
