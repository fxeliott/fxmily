-- F1 — OPTIONAL TradingView analysis link beside the mandatory backtest
-- screenshot. Pure additive nullable TEXT (mirror of `entry_screenshot_key`):
-- existing rows inherit NULL ("no link"), no backfill needed, no DEFAULT
-- transient dance (scalar nullable). Safe at any scale. §21.5: training-only
-- column, never read by the real edge.
-- AlterTable
ALTER TABLE "training_trades" ADD COLUMN "trading_view_url" TEXT;
