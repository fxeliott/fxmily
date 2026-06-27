-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'training_reply_received';

-- AlterTable
ALTER TABLE "training_annotations" ADD COLUMN     "member_replied_at" TIMESTAMP(3),
ADD COLUMN     "member_reply" TEXT;

-- AlterTable
ALTER TABLE "training_trades" ADD COLUMN     "emotional_state_noted" BOOLEAN,
ADD COLUMN     "no_impulsive_deviation" BOOLEAN,
ADD COLUMN     "plan_followed" BOOLEAN,
ADD COLUMN     "risk_defined_before" BOOLEAN;
