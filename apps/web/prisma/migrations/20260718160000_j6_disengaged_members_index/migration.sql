-- CreateIndex
CREATE INDEX "users_status_deleted_at_last_seen_at_idx" ON "users"("status", "deleted_at", "last_seen_at");
