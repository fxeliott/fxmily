-- CreateTable
CREATE TABLE "weekly_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "risks" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "patterns" JSONB NOT NULL,
    "claude_model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_create_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_eur" DECIMAL(10,6) NOT NULL,
    "sent_to_admin_at" TIMESTAMP(3),
    "sent_to_admin_email" TEXT,
    "email_message_id" TEXT,

    CONSTRAINT "weekly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weekly_reports_user_id_week_start_idx" ON "weekly_reports"("user_id", "week_start" DESC);

-- CreateIndex
CREATE INDEX "weekly_reports_generated_at_idx" ON "weekly_reports"("generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_reports_user_id_week_start_key" ON "weekly_reports"("user_id", "week_start");

-- AddForeignKey
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
