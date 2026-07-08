/**
 * Showcase / demo accounts that must never appear in the member leaderboard.
 *
 * The public demo account (`demo@fxmily.local`, seeded by `apps/web/scripts/demo/`
 * — cf. `DEMO.email` in `scripts/demo/_shared.ts`) is a vitrine: its data is
 * synthetic and the account is shared + periodically reset, so it is NOT a real
 * member and must be excluded from the ranking entirely — never gathered into a
 * snapshot, and any pre-existing snapshot row is purged on recompute.
 *
 * Matched by email because the demo is identified solely by its fixed seed email
 * (there is no `isDemo` column on `User`). The literal is duplicated here rather
 * than imported from the seed script to avoid a `scripts/` → `src/` boundary
 * crossing; both sides document the shared value. Kept as a list so additional
 * showcase accounts can be excluded later without touching the compute logic.
 */
export const LEADERBOARD_EXCLUDED_EMAILS: readonly string[] = ['demo@fxmily.local'];
