-- V1.6 — SPEC §18.2 email frequency cap support.
--
-- Adds `is_transactional` flag on NotificationQueue + partial index for fast
-- admin lookups of non-transactional recent rows.
--
-- The actual frequency-cap query (used by `lib/push/dispatcher.ts:dispatchOne`)
-- counts `audit_logs WHERE action='notification.fallback.emailed' AND ...`
-- which already has the `(action, created_at)` index. The partial index here
-- supports future admin / observability queries like "show non-transactional
-- notifications enqueued for user X in last 24h".
--
-- Safe migration : NOT NULL DEFAULT FALSE applies cleanly to existing rows
-- (all V1 NotificationType slugs — annotation_received, checkin_*_reminder,
-- douglas_card_delivered, weekly_report_ready — are engagement nudges, not
-- transactional. Future auth-related push types will set this to true at
-- enqueue time.)

ALTER TABLE "notification_queue"
  ADD COLUMN "is_transactional" BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index : only non-transactional rows are subject to frequency caps,
-- so the predicate keeps the index trivially small even at 1000+ members.
CREATE INDEX "notification_queue_user_recent_non_transactional_idx"
  ON "notification_queue" ("user_id", "created_at" DESC)
  WHERE "is_transactional" = FALSE;
