-- Jalon 9 — Web Push notifications foundation (PushSubscription + NotificationPreference + dispatch tracking)
--
-- Adds the database foundation for the J9 Web Push dispatcher:
--   1. NotificationType enum  : +douglas_card_delivered, +weekly_report_ready
--   2. NotificationStatus enum: +dispatching (atomic claim pattern, race-safe between cron runs)
--   3. NotificationQueue ext  : +last_error_code, +next_attempt_at (exponential backoff anchor)
--   4. PushSubscription table : 1 row per (user, browser/device). UNIQUE (user_id, endpoint).
--   5. NotificationPreference : opt-in/opt-out per category. Composite PK (user_id, type).
--   6. Partial index on (status, next_attempt_at) WHERE status IN ('pending','dispatching')
--      — dispatcher hot-path claim. Same pattern as J5 `notification_queue_pending_checkin_dedup`.
--
-- Notes:
--   - ALTER TYPE ADD VALUE IF NOT EXISTS is idempotent on Postgres 12+ and survives a
--     re-run of the migration (e.g. `prisma migrate deploy` after a partial failure).
--   - The new enum values are NOT referenced in this migration's DDL — they're only
--     used at runtime by the dispatcher. Postgres allows ADD VALUE in the same
--     transaction as long as the new value isn't used in that same transaction.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'douglas_card_delivered';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'weekly_report_ready';

-- AlterEnum
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'dispatching';

-- AlterTable (extend NotificationQueue with dispatch tracking columns)
ALTER TABLE "notification_queue"
  ADD COLUMN "last_error_code" TEXT,
  ADD COLUMN "next_attempt_at" TIMESTAMP(3);

-- CreateIndex (dispatcher hot-path: claim rows ready for dispatch)
-- Partial WHERE clause keeps the index narrow — only `pending`/`dispatching` rows
-- are ever scanned by the worker. Postgres ignores `failed` and `sent` entirely.
CREATE INDEX "notification_queue_pending_dispatch_idx"
  ON "notification_queue" ("status", "next_attempt_at")
  WHERE "status" IN ('pending', 'dispatching');

-- CreateTable (PushSubscription — one row per browser/device)
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh_key" TEXT NOT NULL,
    "auth_key" TEXT NOT NULL,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_user_id_endpoint_key" ON "push_subscriptions"("user_id", "endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_last_seen_at_idx" ON "push_subscriptions"("last_seen_at");

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable (NotificationPreference — composite PK on user_id+type)
CREATE TABLE "notification_preferences" (
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id", "type")
);

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
