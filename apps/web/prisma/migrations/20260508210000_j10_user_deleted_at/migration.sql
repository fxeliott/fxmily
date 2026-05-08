-- J10 — RGPD soft-delete column on `users`.
--
-- Adds `deleted_at` (nullable timestamp) used by the `/account/delete`
-- soft-delete flow. The cron `/api/cron/purge-deleted` later hard-deletes
-- rows where `status = 'deleted' AND deleted_at < now() - interval '30 days'`.
--
-- Why a dedicated timestamp (instead of just `updated_at`):
--   - Privacy log : `updated_at` bumps on every harmless mutation, so it
--     cannot be the canonical "deletion requested at" anchor.
--   - Cron predicate clarity : the purge query reads as English, and an index
--     on (status, deleted_at) makes the periodic scan a single index probe.
--   - 24h cancel window : the `/account/delete/cancel` Server Action sets
--     `deleted_at = NULL` AND restores `status = 'active'`. Splitting the
--     two columns means we never have to "undo" a destructive scrub.
--
-- Idempotent : column add is no-op if already present (migrate diff handles).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- Hot-path index for the cron purge scan.
-- Partial index : only soft-deleted rows ever satisfy the predicate, so we
-- skip indexing every active member (saves ~95% of pages at 30 → 1000 members).
CREATE INDEX IF NOT EXISTS "users_status_deleted_at_idx"
  ON "users" ("status", "deleted_at")
  WHERE "status" = 'deleted';
