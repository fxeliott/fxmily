-- CreateEnum
CREATE TYPE "MemberModerationAction" AS ENUM ('suspended', 'reinstated');

-- CreateTable
CREATE TABLE "member_moderation_events" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" "MemberModerationAction" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_moderation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_moderation_events_member_id_created_at_idx" ON "member_moderation_events"("member_id", "created_at");

-- AddForeignKey
ALTER TABLE "member_moderation_events" ADD CONSTRAINT "member_moderation_events_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_moderation_events" ADD CONSTRAINT "member_moderation_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
