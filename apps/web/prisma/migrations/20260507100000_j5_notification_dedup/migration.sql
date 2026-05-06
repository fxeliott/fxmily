-- J5 audit fix (BLOCKER B1) — race-safe dedup on pending check-in reminders.
--
-- Before this migration, `enqueueCheckinReminder` relied on a JS-side
-- check-then-create that could double-insert under concurrent cron runs (or
-- a Hetzner cron retry). We add a Postgres-level unique partial index keyed
-- on (user_id, type, payload->>'date') for `status = 'pending'` rows of the
-- two checkin reminder kinds.
--
-- A unique index on a JSON-extracted expression is safe in Postgres 12+ and
-- gives O(log n) idempotency guarantees we can rely on from the helper code:
-- a concurrent INSERT will hit a unique-violation (P2002) which the helper
-- catches and resolves to a "row already enqueued" no-op.
--
-- We don't create the equivalent for `annotation_received` because that kind
-- is enqueued from inside the annotation-create path which is itself wrapped
-- in `db.$transaction(...)` — concurrency is sequenced upstream.

CREATE UNIQUE INDEX "notification_queue_pending_checkin_dedup"
  ON "notification_queue" ("user_id", "type", ((payload->>'date')))
  WHERE "status" = 'pending'
    AND "type" IN ('checkin_morning_reminder', 'checkin_evening_reminder');
