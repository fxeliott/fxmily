-- J5 — Daily check-ins (SPEC §6.4, §7.4, §15 J5).
-- Adds: enum CheckinSlot
--       enum NotificationType extended with checkin_morning_reminder + checkin_evening_reminder
--       table `daily_checkins`
--       indexes on (user, date desc), (user, slot, date desc), unique (user, date, slot).
--       cascade FK on User delete (RGPD: full data minimisation on member removal).

-- AlterEnum
-- Postgres 12+ allows ALTER TYPE ADD VALUE in a transaction, as long as the
-- new value isn't *used* in the same transaction. Prisma 7 wraps each
-- migration file in a single transaction by default, but we're only adding
-- values here (no INSERT / SELECT-with-cast on the new variants), so this is
-- fine. If Eliot's local Postgres ever rejects this, split into a separate
-- migration ahead of this one.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'checkin_morning_reminder';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'checkin_evening_reminder';

-- CreateEnum
CREATE TYPE "CheckinSlot" AS ENUM ('morning', 'evening');

-- CreateTable
CREATE TABLE "daily_checkins" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slot" "CheckinSlot" NOT NULL,
    "sleep_hours" DECIMAL(4,2),
    "sleep_quality" INTEGER,
    "morning_routine_completed" BOOLEAN,
    "meditation_min" INTEGER,
    "sport_type" TEXT,
    "sport_duration_min" INTEGER,
    "intention" TEXT,
    "plan_respected_today" BOOLEAN,
    "hedge_respected_today" BOOLEAN,
    "caffeine_ml" INTEGER,
    "water_liters" DECIMAL(4,2),
    "stress_score" INTEGER,
    "gratitude_items" TEXT[],
    "mood_score" INTEGER,
    "emotion_tags" TEXT[],
    "journal_note" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_checkins_user_id_date_slot_key" ON "daily_checkins"("user_id", "date", "slot");

-- CreateIndex
CREATE INDEX "daily_checkins_user_id_date_idx" ON "daily_checkins"("user_id", "date" DESC);

-- CreateIndex
CREATE INDEX "daily_checkins_user_id_slot_date_idx" ON "daily_checkins"("user_id", "slot", "date" DESC);

-- AddForeignKey
ALTER TABLE "daily_checkins" ADD CONSTRAINT "daily_checkins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
