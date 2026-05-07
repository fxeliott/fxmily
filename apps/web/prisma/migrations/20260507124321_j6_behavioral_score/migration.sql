-- AlterTable
ALTER TABLE "trades" ALTER COLUMN "emotion_before" DROP DEFAULT,
ALTER COLUMN "emotion_after" DROP DEFAULT;

-- CreateTable
CREATE TABLE "behavioral_scores" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "discipline_score" INTEGER,
    "emotional_stability_score" INTEGER,
    "consistency_score" INTEGER,
    "engagement_score" INTEGER,
    "components" JSONB NOT NULL,
    "sample_size" JSONB NOT NULL,
    "window_days" INTEGER NOT NULL DEFAULT 30,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "behavioral_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "behavioral_scores_user_id_date_idx" ON "behavioral_scores"("user_id", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "behavioral_scores_user_id_date_key" ON "behavioral_scores"("user_id", "date");

-- AddForeignKey
ALTER TABLE "behavioral_scores" ADD CONSTRAINT "behavioral_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
