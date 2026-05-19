-- V1.4 — Débrief Mensuel IA dédié (SPEC §25, jalon #2 de la séquence §21.6).
--
-- TWO changes, ADD-only (safe — no DROP, no rename, no NOT-NULL-on-populated,
-- no backfill, no ALTER on a pre-existing/populated table):
--   1. ALTER TYPE "NotificationType" ADD VALUE 'monthly_debrief_ready'
--      (member-facing monthly-debrief-ready push; no admin monthly push by
--      design, SPEC §25.2).
--   2. CREATE TABLE "monthly_debriefs" — member-facing dual-section monthly
--      AI debrief (cost-tracking mirror weekly_reports + member dispatch
--      state; NO admin dispatch column).
--   3. 1 regular index (member timeline) + 1 unique index (idempotency).
--   4. 1 FK "monthly_debriefs"->"users" ON DELETE CASCADE (RGPD §17).
--
-- The statements below are byte-identical to the canonical `prisma migrate
-- diff` output (established repo discipline — #112
-- `20260517170000_v1_2_training_annotation_notification` + #132
-- `20260518150000_v1_3_training_debrief` were authored the same way;
-- Prisma 7.8.0 emits bare `ADD VALUE` WITHOUT `IF NOT EXISTS` — the older
-- J5/J9 hand-added `IF NOT EXISTS` is a legacy deviation NOT reproduced,
-- byte-equivalence to the diff wins).
--
-- STATISTICAL-ISOLATION INVARIANT (SPEC §21.5/§25.7 — BLOCKING product rule):
--   This migration touches ZERO real-edge object. "monthly_debriefs" has NO
--   foreign key to "trades", "weekly_reports", "training_trades" or
--   "behavioral_scores"; the ONLY relation is
--   "monthly_debriefs"."user_id" -> "users"."id" (same shape as
--   "training_debriefs" / "training_trades"). The ≤4 weekly_reports rows of
--   the civil month are read as INPUT context by the pure aggregator, never
--   linked as an FK, so the debrief can never leak into / be fed by the real
--   track-record / score / expectancy / Habit×Trade correlation. The
--   "summary_real" / "summary_training" split makes the §21.5 boundary
--   visible in the schema itself; the training section is count/recurrence
--   only (sourced from the J-T4 `countRecentTrainingActivity` primitive),
--   never a backtest `result_r` / `outcome` / `planned_rr`.
--   Verified: the generated SQL below contains zero REFERENCES "trades",
--   zero REFERENCES "weekly_reports", zero REFERENCES "training_trades",
--   zero REFERENCES "behavioral_scores".
--
-- POSTGRESQL TRANSACTION SUBTLETY (verified against #J5 `20260506200000` +
-- #J9 `20260508180000`, which combined ADD VALUE with CREATE TABLE in one
-- Prisma-wrapped transaction): on PostgreSQL 12+, `ALTER TYPE ... ADD VALUE`
-- is allowed inside a transaction block; the only hard rule is the new value
-- cannot be *used* (INSERT/cast/SELECT-with-cast) in the SAME transaction.
-- "monthly_debriefs" has NO NotificationType column — it never uses
-- 'monthly_debrief_ready' — so this migration is fully transaction-safe.
-- The runtime code that ENQUEUES this notification type (J-M3) lands in a
-- later commit, never in this migration.
--
-- DANGEROUS-PATTERN VERDICT: SAFE. Purely additive (1 enum value + 1
--   brand-new empty table). No data loss, no rename, no backfill, no FK
--   change, no NOT-NULL on a populated column. `ALTER TYPE ADD VALUE` takes
--   a brief lock on the enum TYPE only; `CREATE TABLE` is a sub-second
--   metadata change at the V1 30-member prod scale.
--
-- ROLLBACK — the enum part is NON-REVERSIBLE in PostgreSQL (there is NO
-- `ALTER TYPE ... DROP VALUE`). Documented manual procedure (do NOT
-- automate the enum rebuild). To be transcribed into
-- docs/runbook-hetzner-deploy.md §19 at close-out, mirroring the
-- §15/§16/§17/§18 separate-PR pattern; authoritative until then:
--   1. Quiesce: stop the web container so no new rows can be enqueued.
--   2. The table is a brand-new + empty object at V1.4 apply time, so an
--      immediate rollback is loss-free; once members have generated monthly
--      debriefs, `pg_dump -t monthly_debriefs` BEFORE rollback is mandatory
--      (RGPD: AI-synthesised member-facing reflective text). No "users"
--      data is touched (the FK is on the monthly_debriefs side only).
--   3. Purge any rows that used the enum value (only if J-M3 runtime
--      shipped + ran):
--        DELETE FROM "notification_queue"       WHERE "type" = 'monthly_debrief_ready';
--        DELETE FROM "notification_preferences" WHERE "type" = 'monthly_debrief_ready';
--   4. Drop the table + rebuild the enum without the value (one transaction,
--      web stopped):
--        BEGIN;
--        DROP TABLE IF EXISTS "monthly_debriefs";
--        ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
--        CREATE TYPE "NotificationType" AS ENUM (
--          'annotation_received',
--          'training_annotation_received',
--          'checkin_morning_reminder',
--          'checkin_evening_reminder',
--          'douglas_card_delivered',
--          'weekly_report_ready'
--        );
--        ALTER TABLE "notification_queue"
--          ALTER COLUMN "type" TYPE "NotificationType"
--          USING ("type"::text::"NotificationType");
--        ALTER TABLE "notification_preferences"
--          ALTER COLUMN "type" TYPE "NotificationType"
--          USING ("type"::text::"NotificationType");
--        DROP TYPE "NotificationType_old";
--        DELETE FROM "_prisma_migrations"
--          WHERE migration_name = '20260519150000_v1_4_monthly_debrief';
--        COMMIT;
--      (Step 4 fails fast if any surviving row still references the value —
--      step 3 must complete first.)
-- Production-safe at 30-member scale: forward apply is a single sub-second
-- catalog change + an empty CREATE TABLE; this migration accumulates onto
-- the still-pending prod carry-over and applies in the SAME
-- `prisma:migrate:deploy` maintenance window, in timestamp order.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'monthly_debrief_ready';

-- CreateTable
CREATE TABLE "monthly_debriefs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month_start" DATE NOT NULL,
    "month_end" DATE NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "progression_narrative" TEXT NOT NULL,
    "summary_real" TEXT NOT NULL,
    "summary_training" TEXT NOT NULL,
    "risks" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "patterns" JSONB NOT NULL,
    "claude_model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_create_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_eur" DECIMAL(10,6) NOT NULL,
    "sent_to_member_at" TIMESTAMP(3),
    "sent_to_member_email" TEXT,
    "push_enqueued_at" TIMESTAMP(3),

    CONSTRAINT "monthly_debriefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monthly_debriefs_user_id_month_start_idx" ON "monthly_debriefs"("user_id", "month_start" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "monthly_debriefs_user_id_month_start_key" ON "monthly_debriefs"("user_id", "month_start");

-- AddForeignKey
ALTER TABLE "monthly_debriefs" ADD CONSTRAINT "monthly_debriefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
