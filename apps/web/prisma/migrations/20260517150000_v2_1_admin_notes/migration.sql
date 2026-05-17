-- V2.1 Admin private notes — per-member "Notes admin" tab (SPEC §7.7).
--
-- ADD-only migration (safe — no DROP, no rename, no backfill, no ALTER on
-- a populated table):
--   1. CREATE TABLE "admin_notes" — one row per admin note about a member.
--   2. 2 FKs (member + author) both ON DELETE CASCADE (RGPD data
--      minimisation, consistent with the rest of the schema).
--   3. 2 indexes (member feed newest-first + author "notes I authored").
--
-- Rollback (to be transcribed into `docs/runbook-hetzner-deploy.md` §15 at
-- close-out — prior jalons §12/§13/§14 followed the same separate-PR pattern;
-- this block is authoritative until then):
--   BEGIN;
--   DROP TABLE IF EXISTS "admin_notes";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260517150000_v2_1_admin_notes';
--   COMMIT;
-- The table is brand-new + empty at V2.1 apply time, so an immediate
-- rollback is loss-free; once admin notes exist, `pg_dump -t admin_notes`
-- BEFORE rollback is mandatory (RGPD: admin-authored data about a member).
-- No "users" data is touched (the FK is on the admin_notes side only).
-- Production-safe at 30-member scale (<1s table lock per statement).

-- CreateTable
CREATE TABLE "admin_notes" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (member notes feed, newest-first)
CREATE INDEX "admin_notes_member_id_created_at_idx" ON "admin_notes"("member_id", "created_at" DESC);

-- CreateIndex (admin "notes I authored" feed, V2 multi-admin analytics)
CREATE INDEX "admin_notes_author_id_created_at_idx" ON "admin_notes"("author_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
