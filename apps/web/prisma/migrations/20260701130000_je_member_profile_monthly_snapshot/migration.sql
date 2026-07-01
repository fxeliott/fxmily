-- J-E — Check-in mensuel IA profond (ADMIN-ONLY). Trajectoire LONGITUDINALE des
-- 4 dimensions IA re-profilees chaque mois civil, sans jamais ecraser le baseline
-- onboarding "member_profiles" (ADD-only, empile un point par mois).
--
-- ONE change, ADD-only (safe — no DROP, no rename, no NOT-NULL-on-populated,
-- no backfill, no ALTER on a pre-existing/populated table, no enum change):
--   1. CREATE TABLE "member_profile_monthly_snapshots" — admin-only monthly
--      deep re-profiling (cost-tracking mirror "monthly_debriefs"; the 4 deep
--      dims as nullable JSONB + an evolution narrative).
--   2. 1 regular index (member timeline, month_start DESC) + 1 unique index
--      (idempotency (user_id, month_start)).
--   3. 1 FK "member_profile_monthly_snapshots"->"users" ON DELETE CASCADE (RGPD §17).
--
-- The statements below are byte-identical to the canonical `prisma migrate diff`
-- output (established repo discipline — mirror #132 v1.3 / v1.4 monthly_debrief).
--
-- STATISTICAL-ISOLATION INVARIANT (SPEC §21.5/§27.7 — BLOCKING product rule):
--   This migration touches ZERO real-edge object. "member_profile_monthly_snapshots"
--   has NO foreign key to "trades", "weekly_reports", "training_trades" or
--   "behavioral_scores"; the ONLY relation is
--   "member_profile_monthly_snapshots"."user_id" -> "users"."id" (same shape as
--   "monthly_debriefs" / "member_profiles"). None of the 4 dims is ever a scoring
--   input, and "weak_signals" is ADMIN-ONLY (never a member surface). The table is
--   read only by the admin space.
--   Verified: the generated SQL below contains zero REFERENCES "trades",
--   zero REFERENCES "weekly_reports", zero REFERENCES "training_trades",
--   zero REFERENCES "behavioral_scores".
--
-- DANGEROUS-PATTERN VERDICT: SAFE. Purely additive (1 brand-new empty table).
--   No data loss, no rename, no backfill, no FK change on an existing table, no
--   NOT-NULL on a populated column. `CREATE TABLE` is a sub-second metadata
--   change at the current member scale.
--
-- ROLLBACK — the table is a brand-new + empty object at apply time, so an
-- immediate rollback is loss-free. Once snapshots exist, `pg_dump -t
-- member_profile_monthly_snapshots` BEFORE rollback is mandatory (RGPD:
-- AI-synthesised admin-facing reflective text). No "users" data is touched (the
-- FK is on the snapshot side only). To roll back (web stopped):
--   BEGIN;
--   DROP TABLE IF EXISTS "member_profile_monthly_snapshots";
--   DELETE FROM "_prisma_migrations"
--     WHERE migration_name = '20260701130000_je_member_profile_monthly_snapshot';
--   COMMIT;

-- CreateTable
CREATE TABLE "member_profile_monthly_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month_start" DATE NOT NULL,
    "month_end" DATE NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evolution_narrative" TEXT NOT NULL,
    "coaching_tone" JSONB,
    "learning_stage" JSONB,
    "axes_structured" JSONB,
    "weak_signals" JSONB,
    "claude_model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_create_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_eur" DECIMAL(10,6) NOT NULL,

    CONSTRAINT "member_profile_monthly_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_profile_monthly_snapshots_user_id_month_start_idx" ON "member_profile_monthly_snapshots"("user_id", "month_start" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "member_profile_monthly_snapshots_user_id_month_start_key" ON "member_profile_monthly_snapshots"("user_id", "month_start");

-- AddForeignKey
ALTER TABLE "member_profile_monthly_snapshots" ADD CONSTRAINT "member_profile_monthly_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
