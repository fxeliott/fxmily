-- AlterTable
ALTER TABLE "mt5_account_proofs" ADD COLUMN     "file_purged_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "trade_annotations" ADD COLUMN     "trading_view_url" TEXT;

-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "trading_view_entry_note" TEXT,
ADD COLUMN     "trading_view_exit_note" TEXT;

-- AlterTable
ALTER TABLE "training_annotations" ADD COLUMN     "trading_view_url" TEXT;

-- AlterTable
ALTER TABLE "training_trades" ADD COLUMN     "trading_view_note" TEXT;
