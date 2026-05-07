-- CreateEnum
CREATE TYPE "DouglasCategory" AS ENUM ('acceptance', 'tilt', 'discipline', 'ego', 'probabilities', 'confidence', 'patience', 'consistency', 'fear', 'loss', 'process');

-- CreateTable
CREATE TABLE "mark_douglas_cards" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "DouglasCategory" NOT NULL,
    "quote" TEXT NOT NULL,
    "quote_source_chapter" TEXT NOT NULL,
    "paraphrase" TEXT NOT NULL,
    "exercises" JSONB NOT NULL,
    "trigger_rules" JSONB,
    "hat_class" TEXT NOT NULL DEFAULT 'white',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mark_douglas_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mark_douglas_deliveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "trigger_snapshot" JSONB NOT NULL,
    "triggered_on" DATE NOT NULL,
    "seen_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "helpful" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mark_douglas_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mark_douglas_favorites" (
    "user_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mark_douglas_favorites_pkey" PRIMARY KEY ("user_id","card_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mark_douglas_cards_slug_key" ON "mark_douglas_cards"("slug");

-- CreateIndex
CREATE INDEX "mark_douglas_cards_published_priority_idx" ON "mark_douglas_cards"("published", "priority" DESC);

-- CreateIndex
CREATE INDEX "mark_douglas_cards_category_published_idx" ON "mark_douglas_cards"("category", "published");

-- CreateIndex
CREATE INDEX "mark_douglas_deliveries_user_id_created_at_idx" ON "mark_douglas_deliveries"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "mark_douglas_deliveries_user_id_seen_at_idx" ON "mark_douglas_deliveries"("user_id", "seen_at");

-- CreateIndex
CREATE INDEX "mark_douglas_deliveries_user_id_card_id_created_at_idx" ON "mark_douglas_deliveries"("user_id", "card_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "mark_douglas_deliveries_user_id_card_id_triggered_on_key" ON "mark_douglas_deliveries"("user_id", "card_id", "triggered_on");

-- CreateIndex
CREATE INDEX "mark_douglas_favorites_user_id_created_at_idx" ON "mark_douglas_favorites"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "mark_douglas_deliveries" ADD CONSTRAINT "mark_douglas_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_douglas_deliveries" ADD CONSTRAINT "mark_douglas_deliveries_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "mark_douglas_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_douglas_favorites" ADD CONSTRAINT "mark_douglas_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_douglas_favorites" ADD CONSTRAINT "mark_douglas_favorites_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "mark_douglas_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
