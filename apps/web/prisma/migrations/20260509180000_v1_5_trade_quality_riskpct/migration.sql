-- V1.5 — Trading-expert calibration (Steenbarger setup quality + Tharp risk %).
--
-- Adds two optional fields to `trades` to enable behavioral coaching V2 features:
--   - `trade_quality` (A | B | C) : Steenbarger best practice — classify the
--     setup BEFORE the outcome is known. Defeats outcome-bias rationalization.
--   - `risk_pct` (Decimal(5, 2)) : Tharp gold rule — never risk more than 1-2%
--     per trade. Captured at form-fill time (no `accountBalance` field in V1).
--
-- Both columns are NULLable so V1 trades created before this migration stay
-- intact. Analytics aggregates exclude NULL rows.
--
-- Partial index on `trade_quality` keeps the index size proportional to the
-- migration adoption rate (V1 trades = NULL = not indexed). PostgreSQL 17
-- supports this idiom natively.

-- 1. New enum type --------------------------------------------------
CREATE TYPE "TradeQuality" AS ENUM ('A', 'B', 'C');

-- 2. New columns ----------------------------------------------------
ALTER TABLE "trades"
  ADD COLUMN "trade_quality" "TradeQuality";

ALTER TABLE "trades"
  ADD COLUMN "risk_pct" DECIMAL(4, 2);
-- DECIMAL(4, 2) covers 0.01 to 99.99 % — aligned with Zod schema `< 100`.
-- Code-reviewer #6 (2026-05-09) — was DECIMAL(5, 2) which allowed up to 999.99.

-- 3. Partial index for the admin coaching view ----------------------
-- Postgres 17 partial index syntax. The `WHERE trade_quality IS NOT NULL`
-- predicate keeps the index trivially small while V1.5 adoption ramps up.
CREATE INDEX "trades_user_id_trade_quality_idx"
  ON "trades" ("user_id", "trade_quality")
  WHERE "trade_quality" IS NOT NULL;
