-- J2 — Resend webhooks, email suppression, atomic daily send counter, 2 notifications.
--
-- Two new NotificationType enum values (weekly_review_reminder, calendar_ready) +
-- three email-ops tables. The enum values are added with IF NOT EXISTS and are NOT
-- referenced by any table/index in this migration, so the whole file stays
-- transaction-safe (PG 12+ rule: an added enum value is unusable only within the
-- same statement that adds it — later CREATE TABLE here never uses them).

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'weekly_review_reminder';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'calendar_ready';

-- CreateTable
CREATE TABLE "email_events" (
    "id" TEXT NOT NULL,
    "svix_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "resend_email_id" TEXT,
    "user_id" TEXT,
    "bounce_type" TEXT,
    "bounce_sub_type" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "bounce_type" TEXT,
    "bounce_sub_type" TEXT,
    "resend_email_id" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "email_send_counters" (
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_send_counters_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_events_svix_id_key" ON "email_events"("svix_id");

-- CreateIndex
CREATE INDEX "email_events_email_idx" ON "email_events"("email");

-- CreateIndex
CREATE INDEX "email_events_user_id_idx" ON "email_events"("user_id");

-- CreateIndex
CREATE INDEX "email_events_created_at_idx" ON "email_events"("created_at");
