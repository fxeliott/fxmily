-- Closes the "avant / pendant / après" emotional axis (master prompt §22):
-- captures the emotions felt DURING the open position, recalled at close
-- alongside `emotion_after`. Same allowlist as emotion_before/emotion_after
-- (enforced at the Zod boundary, not in the DB).
--
-- Mirrors EXACTLY how Prisma generated `emotion_before`/`emotion_after`
-- (20260505160000_j2_trade: `TEXT[] DEFAULT ARRAY[]::TEXT[]`, no NOT NULL —
-- Prisma maps a scalar list `String[]` to a nullable `text[]`) then finalized
-- them (20260507124321_j6_behavioral_score: DROP DEFAULT). The transient
-- DEFAULT backfills pre-existing rows with `{}`; the Prisma client always
-- sends an explicit array on write so the default is then removed.
ALTER TABLE "trades" ADD COLUMN "emotion_during" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "trades" ALTER COLUMN "emotion_during" DROP DEFAULT;
