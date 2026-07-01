-- J1 — pivot capture → lien TradingView (actée par Eliott). The pre-entry and
-- exit PROOF on a real journal trade is now a mandatory TradingView link
-- instead of an uploaded screenshot (the R2 upload path was a stub, so a photo
-- could never attach — the link removes that failure surface entirely).
--
-- Two pure additive nullable TEXT columns (mirror of `screenshot_entry_key` /
-- `screenshot_exit_key`): existing rows inherit NULL, no backfill, no DEFAULT
-- transient dance (scalar nullable). Safe at any scale, no table rewrite.
-- Required-ness is enforced at the Zod / Server Action edge, exactly like the
-- former screenshot rule; the columns stay nullable for pre-J1 rows +
-- administrative repairs. Host-allowlisted to tradingview.com at the app edge.

-- AlterTable
ALTER TABLE "trades" ADD COLUMN "trading_view_entry_url" TEXT;
ALTER TABLE "trades" ADD COLUMN "trading_view_exit_url" TEXT;
