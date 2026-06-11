-- S3 §33.4 vision pipeline — two ADD-only dedup keys (SPEC §33.3 "à raffiner
-- en impl, migration ADD-only"):
--
--   - broker_accounts.account_login : the MT5 login (account number) printed
--     in the proof header. THE dedup key for "combien de comptes" (§30) —
--     two proofs of the same login resolve to ONE account row. Nullable:
--     member-declared rows get it backfilled by the vision persist.
--   - extracted_positions.ticket : MT5 ticket/order number when the layout
--     prints it (desktop history). Strongest per-position dedup key;
--     nullable (mobile layouts don't print tickets).
--
-- The partial-duplicate guard is a plain composite UNIQUE: Postgres treats
-- NULLs as distinct, so several member-declared accounts without a login
-- never collide. Existing rows are unaffected (both columns NULL).

-- AlterTable
ALTER TABLE "broker_accounts" ADD COLUMN     "account_login" TEXT;

-- AlterTable
ALTER TABLE "extracted_positions" ADD COLUMN     "ticket" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "broker_accounts_member_id_account_login_key" ON "broker_accounts"("member_id", "account_login");
