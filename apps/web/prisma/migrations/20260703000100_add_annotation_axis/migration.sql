-- J-AI corrections echo: let the admin tag a coaching correction with an
-- optional process axis on trade + backtest annotations. Nullable, no default:
-- existing rows stay untagged, the enum `TrackingAxis` already exists.

-- AlterTable
ALTER TABLE "trade_annotations" ADD COLUMN "axis" "TrackingAxis";

-- AlterTable
ALTER TABLE "training_annotations" ADD COLUMN "axis" "TrackingAxis";
