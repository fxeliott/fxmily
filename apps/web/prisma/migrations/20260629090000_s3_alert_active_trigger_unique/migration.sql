-- S3 §33.5 — enforce « at most ONE active (non-dismissed) alert per
-- (member, trigger_type) » at the DATABASE level.
--
-- scanAlertsForMember (lib/verification/alerts.ts) reads existing alerts in the
-- window into memory, then creates without a transaction or DB constraint. The
-- function is reachable from TWO interleaving entry points — the daily
-- `verification-scan` cron AND an event-driven `batch.ts` pass right after a
-- vision parse — so both can read « no alert for this trigger » before either
-- commits and both INSERT, producing a DUPLICATE active alert AND a second
-- Mark Douglas coaching dispatch (the member nudged twice for one pattern).
-- Same fix shape as `discrepancies_reconcile_key_uniq` (20260628210000) and
-- `mental_micro_objectives_one_open_per_member` (20260627120000): a partial
-- unique index Postgres enforces cluster-wide (multi-process / multi-instance
-- safe), and the app folds the resulting P2002 into a no-op (alerts.ts
-- `isUniqueConstraintError` → `continue`).
--
-- The index is PARTIAL on `status <> 'dismissed'` on purpose: a dismissed alert
-- is terminal (the member/admin closed it), so it must NOT block a future
-- re-alert for the same pattern, and it can freely coexist with a fresh active
-- one. The window-level dedup in the app (one alert per pattern per window)
-- still governs the common path; this index only kills the concurrent-race and
-- the cross-window duplicate.

-- 1) Heal any pre-existing duplicates: keep the EARLIEST active alert per
--    (member_id, trigger_type) and delete the later active ones. The only FK to
--    `alerts` is `MarkDouglasDelivery.sourceAlertId` (onDelete: SetNull), so a
--    deleted duplicate simply unlinks its already-delivered coaching card —
--    nothing is orphaned, no penalty is involved (alerts carry no ScoreEvent).
--    Dismissed rows are left untouched (the index excludes them). Idempotent:
--    a no-op when there are no duplicates.
DELETE FROM "alerts"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY "member_id", "trigger_type"
             ORDER BY "created_at" ASC, "id" ASC
           ) AS rn
    FROM "alerts"
    WHERE "status" <> 'dismissed'
  ) ranked
  WHERE ranked.rn > 1
);

-- 2) Partial unique index — at most ONE active alert per (member, trigger_type).
CREATE UNIQUE INDEX "alerts_active_trigger_uniq"
  ON "alerts"("member_id", "trigger_type")
  WHERE "status" <> 'dismissed';
