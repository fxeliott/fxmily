-- CreateEnum
CREATE TYPE "CaptureContext" AS ENUM ('hot', 'cold', 'scheduled');

-- CreateEnum
CREATE TYPE "TrackingAxis" AS ENUM ('execution', 'risk_discipline', 'market_analysis', 'training', 'formation', 'meeting_presence', 'emotions_confidence', 'sleep_lifestyle', 'evening_review', 'self_work', 'routine');

-- CreateTable
CREATE TABLE "tracking_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "instrument_key" TEXT NOT NULL,
    "instrument_version" TEXT NOT NULL DEFAULT 'v1',
    "axis" "TrackingAxis" NOT NULL,
    "occurrence_key" TEXT NOT NULL,
    "responses" JSONB NOT NULL,
    "confidence_level" INTEGER,
    "capture_context" "CaptureContext",
    "response_latency_ms" INTEGER,
    "prompted_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_schedules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "instrument_key" TEXT NOT NULL,
    "next_due_at" TIMESTAMP(3) NOT NULL,
    "last_completed_at" TIMESTAMP(3),
    "cadence_state" JSONB,
    "paused_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracking_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracking_entries_user_id_axis_submitted_at_idx" ON "tracking_entries"("user_id", "axis", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "tracking_entries_user_id_instrument_key_submitted_at_idx" ON "tracking_entries"("user_id", "instrument_key", "submitted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tracking_entries_user_id_instrument_key_occurrence_key_key" ON "tracking_entries"("user_id", "instrument_key", "occurrence_key");

-- CreateIndex
CREATE INDEX "tracking_schedules_user_id_next_due_at_idx" ON "tracking_schedules"("user_id", "next_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_schedules_user_id_instrument_key_key" ON "tracking_schedules"("user_id", "instrument_key");

-- AddForeignKey
ALTER TABLE "tracking_entries" ADD CONSTRAINT "tracking_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_schedules" ADD CONSTRAINT "tracking_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
