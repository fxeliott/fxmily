-- J4 — Admin annotation workflow + notification queue (SPEC §6.3, §7.8, §15 J4).
-- Adds: enums (AnnotationMediaType, NotificationType, NotificationStatus)
--       tables `trade_annotations`, `notification_queue`
--       indexes on (trade, createdAt), (trade, seenByMemberAt), (admin, createdAt),
--                  (status, scheduledFor), (user, createdAt).
--       cascade FKs on Trade and User delete (V1 single-admin assumption).

-- CreateEnum
CREATE TYPE "AnnotationMediaType" AS ENUM ('image', 'video');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('annotation_received');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "trade_annotations" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "media_key" TEXT,
    "media_type" "AnnotationMediaType",
    "seen_by_member_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_annotations_trade_id_created_at_idx" ON "trade_annotations"("trade_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "trade_annotations_trade_id_seen_by_member_at_idx" ON "trade_annotations"("trade_id", "seen_by_member_at");

-- CreateIndex
CREATE INDEX "trade_annotations_admin_id_created_at_idx" ON "trade_annotations"("admin_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "trade_annotations" ADD CONSTRAINT "trade_annotations_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_annotations" ADD CONSTRAINT "trade_annotations_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "notification_queue" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduled_for" TIMESTAMP(3),
    "dispatched_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_queue_status_scheduled_for_idx" ON "notification_queue"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "notification_queue_user_id_created_at_idx" ON "notification_queue"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "notification_queue" ADD CONSTRAINT "notification_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
