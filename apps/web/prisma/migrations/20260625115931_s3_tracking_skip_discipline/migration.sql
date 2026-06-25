-- AlterEnum
ALTER TYPE "DiscrepancyType" ADD VALUE 'tracking_skipped_no_reason';

-- AlterTable
ALTER TABLE "discrepancies" ADD COLUMN     "tracking_ref" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "discrepancies_member_id_tracking_ref_key" ON "discrepancies"("member_id", "tracking_ref");
