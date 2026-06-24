-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "moved_to_be" BOOLEAN,
ADD COLUMN     "partial_at_target" BOOLEAN,
ADD COLUMN     "sl_per_rule" BOOLEAN;
