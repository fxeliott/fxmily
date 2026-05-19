-- V1.5 — QCM athlète / auto-évaluation mindset hebdomadaire (SPEC §27,
-- jalon #3 de la séquence §21.6).
--
-- TWO changes, ADD-only (safe — no DROP, no rename, no NOT-NULL-on-populated,
-- no backfill, no ALTER on a pre-existing/populated table):
--   1. ALTER TYPE "NotificationType" ADD VALUE 'mindset_check_ready'
--      (member-facing mindset-check-ready push; mirror monthly_debrief_ready;
--      no admin mindset push by design, SPEC §27.x).
--   2. CREATE TABLE "mindset_checks" — member-owned WEEKLY mindset
--      self-check (frozen code-versioned Likert instrument + raw responses
--      JSON; 100% deterministic, zero AI / zero API / zero pipeline).
--   3. 1 regular index (member timeline) + 1 unique index (idempotency).
--   4. 1 FK "mindset_checks"->"users" ON DELETE CASCADE (RGPD §17).
--
-- The statements below are byte-identical to the canonical `prisma migrate
-- diff` output (established repo discipline — #112
-- `20260517170000_v1_2_training_annotation_notification` + #132
-- `20260518150000_v1_3_training_debrief` + #135
-- `20260519150000_v1_4_monthly_debrief` were authored the same way;
-- Prisma 7.8.0 emits bare `ADD VALUE` WITHOUT `IF NOT EXISTS` — the older
-- J5/J9 hand-added `IF NOT EXISTS` is a legacy deviation NOT reproduced,
-- byte-equivalence to the diff wins).
--
-- STATISTICAL-ISOLATION INVARIANT (SPEC §21.5/§27.7 — BLOCKING product rule):
--   This migration touches ZERO real-edge object. "mindset_checks" has NO
--   foreign key to "trades", "weekly_reports", "training_trades" or
--   "behavioral_scores"; the ONLY relation is
--   "mindset_checks"."user_id" -> "users"."id" (same shape as
--   "training_debriefs" / "monthly_debriefs" / "training_trades"). A mindset
--   row can never reference a real-edge object, so this entity can never
--   leak into / be fed by the real track-record / score / expectancy /
--   engagement / Habit×Trade correlation / trigger. The questionnaire is a
--   FROZEN code-versioned Likert instrument ("instrument_version" pins the
--   exact item set a submission was answered against); the raw "responses"
--   JSON is the only stored payload — the mindset profile (dimensions,
--   trends) is ALWAYS computed at render, NEVER stored (derived data has no
--   column, anti-drift, single source of truth). 100% deterministic — zero
--   AI / zero API / zero pipeline / zero free-text (no crisis/injection
--   surface). The isolation is enforced by the schema shape itself.
--   Verified: the generated SQL below contains zero REFERENCES "trades",
--   zero REFERENCES "weekly_reports", zero REFERENCES "training_trades",
--   zero REFERENCES "behavioral_scores".
--
-- POSTGRESQL TRANSACTION SUBTLETY (verified against #J5 `20260506200000` +
-- #J9 `20260508180000` + #135 `20260519150000`, which combined ADD VALUE
-- with CREATE TABLE in one Prisma-wrapped transaction): on PostgreSQL 12+,
-- `ALTER TYPE ... ADD VALUE` is allowed inside a transaction block; the only
-- hard rule is the new value cannot be *used* (INSERT/cast/SELECT-with-cast)
-- in the SAME transaction. "mindset_checks" has NO NotificationType column —
-- it never uses 'mindset_check_ready' — so this migration is fully
-- transaction-safe. The runtime code that ENQUEUES this notification type
-- lands in a later commit, never in this migration.
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
-- docs/runbook-hetzner-deploy.md (section after §19) at close-out, mirroring
-- the §15/§16/§17/§18/§19 separate-PR pattern; authoritative until then:
--   1. Quiesce: stop the web container so no new rows can be enqueued.
--   2. The table is a brand-new + empty object at V1.5 apply time, so an
--      immediate rollback is loss-free; once members have submitted mindset
--      checks, `pg_dump -t mindset_checks` BEFORE rollback is mandatory
--      (RGPD: member-authored self-assessment responses). No "users" data
--      is touched (the FK is on the mindset_checks side only).
--   3. Purge any rows that used the enum value (only if the runtime that
--      enqueues 'mindset_check_ready' shipped + ran):
--        DELETE FROM "notification_queue"       WHERE "type" = 'mindset_check_ready';
--        DELETE FROM "notification_preferences" WHERE "type" = 'mindset_check_ready';
--   4. Drop the table + rebuild the enum without the value (one transaction,
--      web stopped):
--        BEGIN;
--        DROP TABLE IF EXISTS "mindset_checks";
--        ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
--        CREATE TYPE "NotificationType" AS ENUM (
--          'annotation_received',
--          'training_annotation_received',
--          'checkin_morning_reminder',
--          'checkin_evening_reminder',
--          'douglas_card_delivered',
--          'weekly_report_ready',
--          'monthly_debrief_ready'
--        );
--        ALTER TABLE "notification_queue"
--          ALTER COLUMN "type" TYPE "NotificationType"
--          USING ("type"::text::"NotificationType");
--        ALTER TABLE "notification_preferences"
--          ALTER COLUMN "type" TYPE "NotificationType"
--          USING ("type"::text::"NotificationType");
--        DROP TYPE "NotificationType_old";
--        DELETE FROM "_prisma_migrations"
--          WHERE migration_name = '20260519170000_v1_5_mindset_check';
--        COMMIT;
--      (Step 4 fails fast if any surviving row still references the value —
--      step 3 must complete first.)
-- Production-safe at 30-member scale: forward apply is a single sub-second
-- catalog change + an empty CREATE TABLE; this migration accumulates onto
-- the still-pending prod carry-over and applies in the SAME
-- `prisma:migrate:deploy` maintenance window, in timestamp order.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'mindset_check_ready';

-- CreateTable
CREATE TABLE "mindset_checks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "instrument_version" INTEGER NOT NULL,
    "responses" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mindset_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mindset_checks_user_id_week_start_idx" ON "mindset_checks"("user_id", "week_start" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "mindset_checks_user_id_week_start_key" ON "mindset_checks"("user_id", "week_start");

-- AddForeignKey
ALTER TABLE "mindset_checks" ADD CONSTRAINT "mindset_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
