/**
 * S3 §33 — FR presentation labels for repetition-alert trigger types, shown in
 * the admin verification panel (`components/admin/member-verification-panel.tsx`).
 *
 * Extracted from the panel so that `alert-labels.test.ts` can assert a 1:1
 * coverage against `ALERT_RULES` (lib/verification/alerts.ts): adding a new rule
 * there now FAILS the unit suite until its label lands here. This kills the drift
 * class that had let `meeting_missed_repeat` (the §31 rule) render as its raw
 * English slug because the static panel map was never updated in parallel.
 *
 * Pure presentation data (no `server-only`): importable from the server-rendered
 * panel and from the unit test alike.
 */
export const ALERT_LABELS: Record<string, string> = {
  forgot_no_reason_repeat: 'Journées sans suivi répétées',
  reality_gap_repeat: 'Écarts déclaré/réalité répétés',
  false_declaration_repeat: 'Fausses déclarations répétées',
  meeting_missed_repeat: 'Réunions manquées répétées',
  tracking_skipped_repeat: 'Outils de suivi régulièrement laissés de côté',
};
