-- AlterTable
ALTER TABLE "member_profiles" ADD COLUMN     "axes_structured" JSONB,
ADD COLUMN     "coaching_tone" JSONB,
ADD COLUMN     "learning_stage" JSONB,
ADD COLUMN     "weak_signals" JSONB;
