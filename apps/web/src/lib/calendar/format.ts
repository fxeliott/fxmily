/**
 * §26 Calendrier adaptatif — pure display formatters (J-C4).
 *
 * Shared by the member page (`/calendrier`) and the admin panel
 * (`?tab=calendar`) so the AI model label is a single source of truth (no
 * per-surface drift). Pure — no DB, no `server-only` — safe in any component.
 */

/**
 * Anti-drift AI model label for the `<AIGeneratedBanner>` (mirror
 * `monthly-debrief-reader`). The batch persists the `claude-code-local`
 * sentinel ($0 local Claude Max), shown as a human "subscription locale".
 */
export function modelDisplay(claudeModel: string): string {
  return claudeModel === 'claude-code-local'
    ? 'Claude · subscription locale'
    : `Claude ${claudeModel}`;
}
