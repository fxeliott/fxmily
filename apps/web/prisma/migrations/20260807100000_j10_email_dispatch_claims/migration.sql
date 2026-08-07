-- J10 correctif n°6 — clé d'idempotence des envois « une fois par période ».
--
-- Migration ADDITIVE : une seule table neuve, aucune colonne existante touchée,
-- aucune donnée réécrite. Elle ne peut pas casser un déploiement en cours ni
-- une lecture existante.

-- CreateTable
CREATE TABLE "email_dispatch_claims" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_dispatch_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_dispatch_claims_type_claimed_at_idx" ON "email_dispatch_claims"("type", "claimed_at");

-- CreateIndex
-- C'est CETTE contrainte qui ferme le doublon : un membre, un type d'envoi,
-- une période = une seule réservation possible, quelle que soit la
-- concurrence.
CREATE UNIQUE INDEX "email_dispatch_claims_user_id_type_period_key" ON "email_dispatch_claims"("user_id", "type", "period");

-- AddForeignKey
ALTER TABLE "email_dispatch_claims" ADD CONSTRAINT "email_dispatch_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
