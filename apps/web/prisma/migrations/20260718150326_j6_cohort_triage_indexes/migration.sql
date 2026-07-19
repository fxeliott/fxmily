-- CreateIndex
CREATE INDEX "discrepancies_status_detected_at_id_idx" ON "discrepancies"("status", "detected_at", "id");

-- CreateIndex
CREATE INDEX "mark_douglas_deliveries_created_at_idx" ON "mark_douglas_deliveries"("created_at");

-- CreateIndex
CREATE INDEX "trades_closed_at_id_idx" ON "trades"("closed_at", "id");

-- CreateIndex
CREATE INDEX "trades_closed_at_entered_at_id_idx" ON "trades"("closed_at", "entered_at", "id");
