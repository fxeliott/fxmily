-- CreateEnum
CREATE TYPE "MentalObjectiveStatus" AS ENUM ('open', 'kept', 'missed', 'dismissed');

-- CreateTable
CREATE TABLE "mental_micro_objectives" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "axis" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intention" TEXT NOT NULL,
    "status" "MentalObjectiveStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mental_micro_objectives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mental_micro_objectives_member_id_status_idx" ON "mental_micro_objectives"("member_id", "status");

-- AddForeignKey
ALTER TABLE "mental_micro_objectives" ADD CONSTRAINT "mental_micro_objectives_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
