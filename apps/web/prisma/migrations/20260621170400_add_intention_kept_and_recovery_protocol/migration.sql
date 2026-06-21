-- AlterTable
ALTER TABLE "daily_checkins" ADD COLUMN     "intention_kept" BOOLEAN;

-- AlterTable
ALTER TABLE "member_profiles" ADD COLUMN     "recovery_protocol" JSONB;
