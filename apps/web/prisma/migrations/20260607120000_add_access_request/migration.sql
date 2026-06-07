-- V2.5 — Self-service access requests (public "Rejoindre" front door).
--
-- Purely ADDITIVE migration: introduces a new enum + a new table with its own
-- indexes + a single SetNull FK to `users`. NO ALTER on any existing table, no
-- data backfill, no transient DEFAULT dance — safe at any scale and trivially
-- reversible (DROP TABLE + DROP TYPE).
--
-- RGPD: this table stores a NON-member's name + email (PII without account
-- consent). The `/api/cron/purge-access-requests` weekly cron deletes resolved
-- rows (approved/rejected) and stale pending rows (> 30d) so it never
-- accumulates dormant PII. `reviewed_by_id` is SetNull so a purged admin
-- doesn't cascade-erase the request's lifecycle trace. `invitation_id` is a
-- loose pointer (no FK) to the invitation minted on approval (it has its own
-- TTL + purge path; the two lifecycles are intentionally decoupled).

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "invitation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_requests_status_created_at_idx" ON "access_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "access_requests_email_idx" ON "access_requests"("email");

-- CreateIndex (PARTIAL UNIQUE — at most one PENDING request per email).
-- Prisma 7 can't model partial-predicate indexes declaratively, so this lives
-- in migration SQL only (NOT as an @@index in schema.prisma, same pattern as
-- the notification_queue partial indexes — avoids a duplicate full index +
-- drift). Race guard for concurrent self-service double-submits under Read
-- Committed (the service catches the resulting P2002 as a neutral dedup).
-- approved/rejected rows are excluded, so re-requesting after a rejection works.
CREATE UNIQUE INDEX "access_requests_email_pending_uniq" ON "access_requests"("email") WHERE "status" = 'pending';

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
