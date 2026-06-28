-- S3 §33.5 — enforce « at most ONE extracted position per (broker_account,
-- ticket) when a ticket was printed » at the DATABASE level.
--
-- persistVisionResults (lib/verification/batch.ts) dedups parsed MT5 positions
-- in memory (read existing tickets → filter `toInsert`) then `createMany`s
-- WITHOUT a DB constraint. Two interleaving vision parses for the SAME broker
-- account (a member uploading two proofs back-to-back, or an OCR retry) can both
-- read « ticket absent » before either commits and both INSERT the same ticket,
-- producing a DUPLICATE position. Reconciliation then double-counts it: an extra
-- `missing_declared` accusation (and a NEGATIVE ScoreEvent) for one real trade,
-- or an inflated proven-account/position count. Same fix shape as
-- `discrepancies_reconcile_key_uniq` (20260628210000): a partial unique index
-- Postgres enforces cluster-wide + an ON CONFLICT DO NOTHING insert
-- (`createMany({ skipDuplicates: true })`) so the loser silently no-ops.
--
-- PARTIAL on `ticket IS NOT NULL`: mobile MT5 layouts don't print a ticket
-- (nullable column), and Postgres treats NULLs as distinct anyway — those rows
-- keep the softer (symbol, side, openTime, volume) heuristic dedup in the app
-- and are intentionally NOT constrained here (a false unique on NULL would wrongly
-- collapse two genuinely different ticket-less positions).

-- 1) Heal any pre-existing ticket duplicates: keep the EARLIEST row per
--    (broker_account_id, ticket) and remove the later ones.
--
--    NB: we DELETE the losers' discrepancies (and their penalising ScoreEvents)
--    rather than re-pointing them to the keeper. Re-pointing would risk a
--    unique-violation against `discrepancies_reconcile_key_uniq` (two
--    `missing_declared` rows — one per dup position — would collapse onto the
--    same (member, type, '', keeper) key). A loser position is a DUPLICATE of
--    the keeper, so its accusation is redundant: deleting it (a) removes the
--    double penalty immediately and (b) lets the next daily `verification-scan`
--    re-flag the surviving keeper if it is still unmatched. ScoreEvents must go
--    FIRST (related_discrepancy_id is onDelete:SetNull → deleting the
--    discrepancy alone would orphan and KEEP the penalty). Idempotent: a no-op
--    when there are no duplicates.

-- 1a) drop penalties tied to discrepancies that reference a loser position
DELETE FROM "score_events"
WHERE "related_discrepancy_id" IN (
  SELECT "id" FROM "discrepancies"
  WHERE "extracted_position_id" IN (
    SELECT "id" FROM (
      SELECT "id",
             ROW_NUMBER() OVER (
               PARTITION BY "broker_account_id", "ticket"
               ORDER BY "created_at" ASC, "id" ASC
             ) AS rn
      FROM "extracted_positions"
      WHERE "ticket" IS NOT NULL
    ) ranked
    WHERE ranked.rn > 1
  )
);

-- 1b) drop those (redundant) discrepancies
DELETE FROM "discrepancies"
WHERE "extracted_position_id" IN (
  SELECT "id" FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY "broker_account_id", "ticket"
             ORDER BY "created_at" ASC, "id" ASC
           ) AS rn
    FROM "extracted_positions"
    WHERE "ticket" IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);

-- 1c) delete the loser positions
DELETE FROM "extracted_positions"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY "broker_account_id", "ticket"
             ORDER BY "created_at" ASC, "id" ASC
           ) AS rn
    FROM "extracted_positions"
    WHERE "ticket" IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);

-- 2) Partial unique index — at most ONE position per (account, ticket).
CREATE UNIQUE INDEX "extracted_positions_account_ticket_uniq"
  ON "extracted_positions"("broker_account_id", "ticket")
  WHERE "ticket" IS NOT NULL;
