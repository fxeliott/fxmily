-- SPEC §28/§21 — "oublis" tracking axis (master prompt §28: "exécution en
-- position réelle (respect du plan, oublis)" / §21: "s'il oublie des choses ou
-- non"). Did the member follow ALL their process at close, without forgetting
-- steps? Pure additive nullable Boolean (mirror of `market_analysis_done`):
-- existing rows inherit NULL ("unanswered/legacy"), no backfill needed, no
-- DEFAULT transient dance (scalar nullable, not an array). Safe at any scale.
-- Positive framing (anti-Black-Hat) + SPEC §2 posture: tracks the ACT of
-- completeness/forgetting, never advises on the trade itself.
-- AlterTable
ALTER TABLE "trades" ADD COLUMN "process_complete" BOOLEAN;
