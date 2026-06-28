-- S3 §33.5 — enforce « one reconcile discrepancy per (member, type, declared
-- trade, extracted position) » at the DATABASE level.
--
-- reconcileOneMember (lib/verification/reconcile.ts) read existing écarts into
-- an in-memory Set, then created without a transaction or DB constraint. Two
-- interleaved passes — the daily `verification-scan` cron AND an event-driven
-- `batch.ts` pass — can both read « none » for the same gap before either
-- commits and both INSERT, producing a duplicate accusation AND a duplicate
-- NEGATIVE ScoreEvent (the member punished twice for one presumed gap). Same
-- pattern as `mental_micro_objectives_one_open_per_member` (20260627120000) and
-- `access_requests_email_pending_uniq`: a partial unique index Postgres enforces
-- cluster-wide (multi-process / multi-instance safe), and the app folds the
-- resulting P2002 into a no-op (reconcile.ts `createIfNew`).
--
-- COALESCE(...,'') mirrors the app's in-memory key
-- `${type}|${declaredTradeId ?? ''}|${extractedPositionId ?? ''}`: the
-- discriminating id column is NULL for the type that doesn't use it
-- (declared_trade_id NULL for missing_declared, extracted_position_id NULL for
-- false_declared). A plain column unique index would let those NULLs slip past
-- (Postgres treats NULLs as distinct), so the index is built on COALESCE
-- expressions — exactly the key the app dedups on.

-- 1) Heal any pre-existing duplicates: keep the EARLIEST accusation per key and
--    delete the later ones. The penalising ScoreEvent FK is onDelete:SetNull, so
--    deleting the dup discrepancy alone would orphan (and KEEP) the extra
--    penalty — the events must be deleted EXPLICITLY FIRST, while the link still
--    resolves. This retroactively repairs any member double-penalised by a past
--    race. Idempotent: a no-op when there are no duplicates.
DELETE FROM "score_events"
WHERE "related_discrepancy_id" IN (
  SELECT "id"
  FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY
               "member_id",
               "type",
               COALESCE("declared_trade_id", ''),
               COALESCE("extracted_position_id", '')
             ORDER BY "detected_at" ASC, "id" ASC
           ) AS rn
    FROM "discrepancies"
    WHERE "type" IN ('mismatch', 'false_declared', 'missing_declared')
  ) ranked
  WHERE ranked.rn > 1
);

DELETE FROM "discrepancies"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY
               "member_id",
               "type",
               COALESCE("declared_trade_id", ''),
               COALESCE("extracted_position_id", '')
             ORDER BY "detected_at" ASC, "id" ASC
           ) AS rn
    FROM "discrepancies"
    WHERE "type" IN ('mismatch', 'false_declared', 'missing_declared')
  ) ranked
  WHERE ranked.rn > 1
);

-- 2) Partial unique index — at most ONE reconcile discrepancy per key. The
--    non-reconcile types (meeting_missed_no_reason, tracking_skipped_no_reason,
--    …) are unconstrained here — they keep their own dedup keys
--    (@@unique([memberId, meetingId]) / @@unique([memberId, trackingRef])).
CREATE UNIQUE INDEX "discrepancies_reconcile_key_uniq"
  ON "discrepancies"(
    "member_id",
    "type",
    COALESCE("declared_trade_id", ''),
    COALESCE("extracted_position_id", '')
  )
  WHERE "type" IN ('mismatch', 'false_declared', 'missing_declared');
