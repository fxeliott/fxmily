-- =============================================================================
-- V1.7 §30 — Meeting attendance tracking (J-M1 data layer)
-- =============================================================================
--
-- Migration ADD-only (safe at 30-member scale, no ALTER on existing tables):
--   - 3 new enums (MeetingSlot, MeetingStatus, MeetingAttendanceMode)
--   - 2 new tables: meetings (admin-scoped, 0 FK to users) + meeting_attendances
--     (FK→meetings CASCADE + FK→users CASCADE, RGPD §17)
--   - 4 indexes: meetings (status, scheduled_at DESC) + UNIQUE (date, slot) ;
--     meeting_attendances (user_id, declared_at DESC) + UNIQUE (meeting_id, user_id)
--
-- No standalone single-column index on scheduled_at / meeting_id — each is the
-- leftmost prefix of its composite (repo convention, cf. DailyCheckin/Trade).
--
-- Lock duration estimate at 30 members: <1s (new empty tables, no backfill).
-- Risk: LOW.
--
-- ROLLBACK (pattern carbone V1.3/V1.4/V1.5/V2.3 — see runbook §17→§22) :
--   pg_dump --schema-only --table=meetings --table=meeting_attendances ... > backup_pre_v1_7.sql
--   docker stop fxmily-web
--   BEGIN;
--   DROP TABLE "meeting_attendances";  -- cascade-removes its two FKs
--   DROP TABLE "meetings";
--   DROP TYPE "MeetingAttendanceMode";
--   DROP TYPE "MeetingStatus";
--   DROP TYPE "MeetingSlot";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260530150000_v1_7_meeting_attendance';
--   COMMIT;
--   -- redeploy pre-V1.7 image, verify /api/health 200
--
-- NB: order matters — tables BEFORE types (Postgres rejects a type drop while a
-- column references it). See V2.3/§14 V2.0 rollback recipes for the canon.
-- =============================================================================

-- CreateEnum
CREATE TYPE "MeetingSlot" AS ENUM ('midday', 'evening');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('scheduled', 'cancelled');

-- CreateEnum
CREATE TYPE "MeetingAttendanceMode" AS ENUM ('live', 'replay');

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slot" "MeetingSlot" NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'scheduled',
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_attendances" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "attendance_mode" "MeetingAttendanceMode",
    "content_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_status_scheduled_at_idx" ON "meetings"("status", "scheduled_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "meetings_date_slot_key" ON "meetings"("date", "slot");

-- CreateIndex
CREATE INDEX "meeting_attendances_user_id_declared_at_idx" ON "meeting_attendances"("user_id", "declared_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_attendances_meeting_id_user_id_key" ON "meeting_attendances"("meeting_id", "user_id");

-- AddForeignKey
ALTER TABLE "meeting_attendances" ADD CONSTRAINT "meeting_attendances_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendances" ADD CONSTRAINT "meeting_attendances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
