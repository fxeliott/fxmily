-- F4 — explicit member "absent" self-declaration. One PURE additive boolean on
-- `meeting_attendances`, defaulting false so every existing row reads
-- "not declared absent" (byte-identical to the prior behaviour, no backfill).
-- It distinguishes an explicit "je n'ai pas pu y assister" from a not-yet-declared
-- slot (`en_attente`), so the accompaniment sees an acknowledged absence and the
-- attendance data accumulates. §2/§31.2: a calm boolean acknowledgement, never
-- market content, never punitive; it never counts as a completion.
-- AlterTable
ALTER TABLE "meeting_attendances" ADD COLUMN "member_declared_absent" BOOLEAN NOT NULL DEFAULT false;
