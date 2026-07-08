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
 * sentinel ($0 local Claude Max), shown as a human "abonnement local".
 * A raw API model id ("claude-opus-4-8") is internal jargon a member should
 * never read (runtime finding 2026-07-08, /profile) — humanised into
 * "Claude Opus 4.8": vendor prefix dropped, words title-cased, short numeric
 * segments joined with dots (a ≥8-digit datestamp segment is dropped).
 */
export function modelDisplay(claudeModel: string): string {
  if (claudeModel === 'claude-code-local') return 'Claude · abonnement local';
  const segments = claudeModel.split('-').filter((s) => s.length > 0);
  const words = segments[0]?.toLowerCase() === 'claude' ? segments.slice(1) : segments;
  const name: string[] = [];
  const version: string[] = [];
  for (const word of words) {
    if (/^\d+$/.test(word)) {
      if (word.length < 8) version.push(word);
    } else {
      name.push(word.charAt(0).toUpperCase() + word.slice(1));
    }
  }
  return ['Claude', ...name, version.join('.')].filter(Boolean).join(' ');
}
