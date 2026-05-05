-- J2 — Trading journal (SPEC §6.2, §7.3).
-- Adds: enums (TradeDirection, TradeSession, TradeOutcome, RealizedRSource)
--       table `trades` with userId-leading composite indexes.

-- CreateEnum
CREATE TYPE "TradeDirection" AS ENUM ('long', 'short');

-- CreateEnum
CREATE TYPE "TradeSession" AS ENUM ('asia', 'london', 'newyork', 'overlap');

-- CreateEnum
CREATE TYPE "TradeOutcome" AS ENUM ('win', 'loss', 'break_even');

-- CreateEnum
CREATE TYPE "RealizedRSource" AS ENUM ('computed', 'estimated');

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "direction" "TradeDirection" NOT NULL,
    "session" "TradeSession" NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL,
    "entry_price" DECIMAL(20,8) NOT NULL,
    "lot_size" DECIMAL(12,4) NOT NULL,
    "stop_loss_price" DECIMAL(20,8),
    "planned_rr" DECIMAL(6,2) NOT NULL,
    "emotion_before" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "plan_respected" BOOLEAN NOT NULL,
    "hedge_respected" BOOLEAN,
    "notes" TEXT,
    "screenshot_entry_key" TEXT,
    "exited_at" TIMESTAMP(3),
    "exit_price" DECIMAL(20,8),
    "outcome" "TradeOutcome",
    "realized_r" DECIMAL(6,2),
    "realized_r_source" "RealizedRSource",
    "emotion_after" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "screenshot_exit_key" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trades_user_id_entered_at_idx" ON "trades"("user_id", "entered_at" DESC);

-- CreateIndex
CREATE INDEX "trades_user_id_created_at_idx" ON "trades"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "trades_user_id_closed_at_idx" ON "trades"("user_id", "closed_at");

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
