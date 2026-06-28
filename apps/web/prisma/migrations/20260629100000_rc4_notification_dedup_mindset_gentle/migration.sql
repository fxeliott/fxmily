-- RC#4 audit fix (P3) — extend the J5 race-safe dedup guarantee to the two
-- remaining notification kinds that relied on JS-side read-then-write only:
--   * `mindset_check_ready`        (weekly mindset nudge, lib/mindset/reminders.ts)
--   * `verification_gentle_reminder` (S3 §33 gentle micro-relance, lib/verification/alerts.ts)
--
-- Before this migration both kinds deduped purely in application code (the
-- scan builds an "already-nudged" set then inserts). A re-fired / overlapping
-- cron run (rolling deploy, manual re-invocation) could double-insert, sending
-- the member two identical pushes. The check-in path already closed this with a
-- unique partial index (20260507100000_j5_notification_dedup) + a P2002 no-op
-- fold; we mirror it here so EVERY notification kind has a DB-level idempotency
-- guarantee, not just check-ins.
--
-- ADD-only + self-healing: we first DELETE any pre-existing duplicate PENDING
-- rows (keeping the earliest per dedup key) so the unique index can be created
-- on a prod table that may already hold a stray duplicate. Deleting a duplicate
-- *pending* (never-dispatched) nudge is exactly the dedup we want — the member
-- gets one push, not two. Dispatched rows (status <> 'pending') are untouched.

-- Heal: collapse duplicate pending mindset nudges to the earliest per (user, weekStart).
DELETE FROM "notification_queue" nq
USING (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", (payload->>'weekStart')
      ORDER BY "created_at" ASC, id ASC
    ) AS rn
  FROM "notification_queue"
  WHERE "status" = 'pending'
    AND "type" = 'mindset_check_ready'
) dup
WHERE nq.id = dup.id
  AND dup.rn > 1;

-- Heal: collapse duplicate pending gentle reminders to the earliest per (user, discrepancyId).
DELETE FROM "notification_queue" nq
USING (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", (payload->>'discrepancyId')
      ORDER BY "created_at" ASC, id ASC
    ) AS rn
  FROM "notification_queue"
  WHERE "status" = 'pending'
    AND "type" = 'verification_gentle_reminder'
) dup
WHERE nq.id = dup.id
  AND dup.rn > 1;

-- Mindset weekly nudge: at most one pending row per (user, weekStart).
CREATE UNIQUE INDEX "notification_queue_pending_mindset_dedup"
  ON "notification_queue" ("user_id", "type", ((payload->>'weekStart')))
  WHERE "status" = 'pending'
    AND "type" = 'mindset_check_ready';

-- Gentle verification reminder: at most one pending row per (user, discrepancyId).
CREATE UNIQUE INDEX "notification_queue_pending_gentle_dedup"
  ON "notification_queue" ("user_id", "type", ((payload->>'discrepancyId')))
  WHERE "status" = 'pending'
    AND "type" = 'verification_gentle_reminder';
