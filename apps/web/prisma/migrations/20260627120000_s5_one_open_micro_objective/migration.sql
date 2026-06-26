-- S5 re-challenge #3 — enforce the E3 invariant « ≤ 1 open micro-objective per member »
-- at the DATABASE level. `ensureMicroObjectiveForMember` read (`findFirst open`) then
-- created without a transaction or constraint; two near-simultaneous `after()` member
-- passages (two close-together actions, lib/cards/scheduler.ts) interleave their awaits,
-- both read « none open » and both insert → a permanent orphan open row (breaks brief
-- §32-E3 « un seul objectif ouvert à la fois » + durability §0). The app catches the
-- P2002 from this index and folds the lost race into a no-op.

-- 1) Heal any pre-existing duplicate open rows: keep the most recent open objective per
--    member, mark the older ones `dismissed` (a dismissed loop is NOT a failure — §31.2),
--    stamping closed_at/updated_at so the evolution history stays coherent.
WITH ranked AS (
    SELECT "id",
           ROW_NUMBER() OVER (PARTITION BY "member_id" ORDER BY "created_at" DESC, "id" DESC) AS rn
    FROM "mental_micro_objectives"
    WHERE "status" = 'open'
)
UPDATE "mental_micro_objectives" AS m
SET "status" = 'dismissed', "closed_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
FROM ranked
WHERE m."id" = ranked."id" AND ranked.rn > 1;

-- 2) Partial unique index: at most ONE open objective per member, enforced by Postgres
--    (cluster-wide → multi-process / multi-instance safe). Same pattern as
--    `access_requests_email_pending_uniq` (20260607120000). The non-open statuses are
--    unconstrained (a member can hold many kept/missed/dismissed rows over time).
CREATE UNIQUE INDEX "mental_micro_objectives_one_open_per_member"
    ON "mental_micro_objectives"("member_id")
    WHERE "status" = 'open';
