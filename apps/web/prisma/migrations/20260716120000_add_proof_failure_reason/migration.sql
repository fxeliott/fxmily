-- J4.1 — persist the MT5 verification failure reason.
--
-- Adds `ProofFailureReason` (WHY a proof was terminally refused) and a nullable
-- `failure_reason` column on `mt5_account_proofs`. Both additive:
--   - existing rows keep NULL — the /verification screen reads it defensively
--     and falls back to its generic « Lecture impossible » label;
--   - no existing column is touched.
-- The column is NULLable, without NOT NULL, without a default. It is set only in
-- the SAME UPDATE that flips `ocr_status` to 'failed' (lib/verification/batch.ts).

-- 1. New enum type --------------------------------------------------
CREATE TYPE "ProofFailureReason" AS ENUM ('LOGIN_NOT_FOUND', 'NOT_MT5_SCREEN', 'ANALYSIS_UNREADABLE');

-- 2. New column -----------------------------------------------------
ALTER TABLE "mt5_account_proofs"
  ADD COLUMN "failure_reason" "ProofFailureReason";
