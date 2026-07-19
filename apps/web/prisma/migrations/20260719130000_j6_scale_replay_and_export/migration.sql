-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'data_export_ready';

-- CreateTable
CREATE TABLE "replay_views" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "first_viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_viewed_at" TIMESTAMP(3) NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "replay_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'pending',
    "result_key" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "data_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "replay_views_session_id_idx" ON "replay_views"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "replay_views_session_id_user_id_key" ON "replay_views"("session_id", "user_id");

-- CreateIndex
CREATE INDEX "data_export_jobs_user_id_idx" ON "data_export_jobs"("user_id");

-- CreateIndex
CREATE INDEX "data_export_jobs_status_idx" ON "data_export_jobs"("status");

-- AddForeignKey
ALTER TABLE "replay_views" ADD CONSTRAINT "replay_views_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "replay_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replay_views" ADD CONSTRAINT "replay_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_jobs" ADD CONSTRAINT "data_export_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
