-- S3 §31 (vérification généralisée) — meeting no-show feeds the anti-mensonge chain.
-- Purely additive: new enum value + nullable FK column + dedup unique index.
-- Existing `discrepancies` rows keep meeting_id = NULL (NULLs are distinct in the
-- unique index, so no collision on the back-fill).

-- AlterEnum
ALTER TYPE "DiscrepancyType" ADD VALUE 'meeting_missed_no_reason';

-- AlterTable
ALTER TABLE "discrepancies" ADD COLUMN     "meeting_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "discrepancies_member_id_meeting_id_key" ON "discrepancies"("member_id", "meeting_id");

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
