-- AlterTable
ALTER TABLE "meeting_attendances" ADD COLUMN     "admin_marked_at" TIMESTAMP(3),
ADD COLUMN     "admin_marked_by" TEXT,
ADD COLUMN     "admin_present" BOOLEAN;
