-- AlterTable
ALTER TABLE "users" ADD COLUMN     "weekends_off" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "member_off_days" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_off_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_off_days_user_id_date_idx" ON "member_off_days"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "member_off_days_user_id_date_key" ON "member_off_days"("user_id", "date");

-- AddForeignKey
ALTER TABLE "member_off_days" ADD CONSTRAINT "member_off_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
