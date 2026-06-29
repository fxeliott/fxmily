-- S3 §33.5 — enforce « one blank-day discrepancy per (member, civil day) » at
-- the DATABASE level.
--
-- The daily ritual scan (lib/verification/constancy.ts) materialises ONE
-- excusable `unfilled_no_reason` Discrepancy for a fully blank day, read-then-
-- created with NO transaction and NO DB constraint. Two interleaved passes —
-- the daily `verification-scan` cron AND an event-driven `batch.ts` pass — can
-- both read « none » for the same (member, yesterday) before either commits and
-- both INSERT, producing a DUPLICATE blank-day accusation for one day. Same race
-- class as `discrepancies_reconcile_key_uniq` (20260628210000): a partial unique
-- index Postgres enforces cluster-wide (multi-process / multi-instance safe), and
-- the app folds the resulting P2002 into a no-op (constancy.ts blank-day create).
--
-- `detected_at` is set explicitly to the Paris civil-midnight of YESTERDAY
-- (parseLocalDate → Date.UTC(y,m,d), sub-second zero), so two same-day passes
-- write a byte-identical value — the exact key the app's `findFirst` dedup and
-- this index agree on. The non-blank-day types are unconstrained here (NULL
-- detected_at never occurs; other types keep their own @@unique keys).

-- 1) Heal any pre-existing duplicates. CRITICAL difference from the reconcile
--    heal: the day's `forgot_no_reason` ScoreEvents are deterministic-id
--    (`ritualEventId(...slot)`) + `createMany skipDuplicates`, so there are at
--    most TWO per (member, day) regardless of how many duplicate discrepancies
--    a race produced — they are LEGITIMATE and must be KEPT. They carry the
--    « motif valable » excuse link (`related_discrepancy_id`). So instead of
--    deleting the events (reconcile's approach, where each dup had its OWN
--    penalty), RE-POINT any event referencing a soon-to-be-deleted duplicate to
--    the SURVIVOR (earliest per (member, day)), preserving the excuse link, THEN
--    delete the duplicates. The FK is onDelete:SetNull, so re-pointing BEFORE the
--    delete is what keeps the link from being nulled. Idempotent: a no-op when
--    there are no duplicates.
UPDATE "score_events" e
SET "related_discrepancy_id" = survivor."keep_id"
FROM (
  SELECT
    d."id" AS "dup_id",
    FIRST_VALUE(d."id") OVER (
      PARTITION BY d."member_id", d."detected_at"
      ORDER BY d."detected_at" ASC, d."id" ASC
    ) AS "keep_id"
  FROM "discrepancies" d
  WHERE d."type" = 'unfilled_no_reason'
) survivor
WHERE e."related_discrepancy_id" = survivor."dup_id"
  AND survivor."dup_id" <> survivor."keep_id";

DELETE FROM "discrepancies"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY "member_id", "detected_at"
             ORDER BY "detected_at" ASC, "id" ASC
           ) AS rn
    FROM "discrepancies"
    WHERE "type" = 'unfilled_no_reason'
  ) ranked
  WHERE ranked.rn > 1
);

-- 2) Partial unique index — at most ONE blank-day discrepancy per (member, day).
--    Restricted to `unfilled_no_reason`; every other discrepancy type keeps its
--    own dedup key (@@unique([memberId, meetingId]) / @@unique([memberId,
--    trackingRef]) / discrepancies_reconcile_key_uniq) and is not constrained
--    here.
CREATE UNIQUE INDEX "discrepancies_blank_day_uniq"
  ON "discrepancies"("member_id", "detected_at")
  WHERE "type" = 'unfilled_no_reason';
