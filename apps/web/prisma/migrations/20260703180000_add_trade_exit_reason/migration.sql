-- Tour 10 — factual nature of the exit, answered at close (SPEC §2: the ACT,
-- never a judgement). Pure additive: new enum type + nullable column, no
-- default, no rewrite — every existing row stays NULL (not answered).

-- CreateEnum
CREATE TYPE "TradeExitReason" AS ENUM ('tp_hit', 'sl_hit', 'be_exit', 'manual_before_target', 'time_exit');

-- AlterTable
ALTER TABLE "trades" ADD COLUMN "exit_reason" "TradeExitReason";
