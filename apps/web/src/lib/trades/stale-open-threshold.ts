/**
 * Tour 13 — single source of truth for the "resté ouvert" threshold.
 *
 * Shared by the member-side hub reminder (`lib/trades/service.ts`,
 * `getStaleOpenTradesSummary`) and the admin triage queue
 * (`lib/admin/attention-service.ts`, `listStaleOpenTrades` /
 * `getTriageQueueCounts`). Both sides MUST read the same number AND use the
 * same strict comparator (`enteredAt < now - threshold`, "open LONGER than
 * 72 h") so a trade can never be stale on one side and not on the other.
 *
 * Why it matters: past this point the member never filled the close wizard, so
 * `exitReason` / `planRespected` stay null and the trade silently drops out of
 * every scored view — the member gets a gentle reminder, the coach a
 * safety-net queue.
 */
export const STALE_OPEN_TRADE_HOURS = 72;

export const STALE_OPEN_TRADE_MS = STALE_OPEN_TRADE_HOURS * 60 * 60 * 1000;
