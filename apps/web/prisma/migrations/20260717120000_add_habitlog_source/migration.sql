-- CreateEnum
CREATE TYPE "HabitSource" AS ENUM ('member_track', 'checkin_morning');

-- AlterTable
ALTER TABLE "habit_logs" ADD COLUMN     "source" "HabitSource" NOT NULL DEFAULT 'member_track';
