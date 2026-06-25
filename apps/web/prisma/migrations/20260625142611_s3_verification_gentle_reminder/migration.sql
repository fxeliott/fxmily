-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'verification_gentle_reminder';

-- AlterTable
ALTER TABLE "discrepancies" ADD COLUMN     "gentle_reminder_at" TIMESTAMP(3);
