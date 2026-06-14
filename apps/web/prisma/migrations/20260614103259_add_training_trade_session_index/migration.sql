-- CreateIndex
CREATE INDEX "training_trades_session_id_entered_at_idx" ON "training_trades"("session_id", "entered_at" DESC);

-- RenameIndex
ALTER INDEX "notification_queue_pending_dispatch_idx" RENAME TO "notification_queue_status_next_attempt_at_idx";
