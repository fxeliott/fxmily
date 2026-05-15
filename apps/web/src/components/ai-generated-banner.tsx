import { type ReactNode } from 'react';

/**
 * V1.7 prep DORMANT — EU AI Act 50(1) chatbot transparency banner.
 *
 * Mandatory before deadline **2 août 2026** (Article 50(1) Regulation (EU)
 * 2024/1689). Penalty for non-compliance : **€15M ou 3% du CA mondial
 * annuel** (Article 99(4)). Source primaire :
 *   - https://artificialintelligenceact.eu/article/50/
 *   - https://artificialintelligenceact.eu/article/99/
 *
 * No official template is mandated by the AI Act ; the formulation below
 * was validated by Round 4 verifier subagent (2026-05-12) as a conservative
 * acceptable wording :
 *
 *   "Ce rapport est généré par une intelligence artificielle (Claude,
 *    Anthropic). Il ne remplace ni un coaching humain, ni un avis médical,
 *    ni un conseil en investissement personnalisé."
 *
 * V1.7 wiring map (NOT included in this file) :
 *   1. `/admin/reports/[id]/page.tsx` — inline variant at the top of the
 *      report detail view, BEFORE the summary section.
 *   2. `lib/email/templates/weekly-digest.tsx` — adapted plain-HTML banner
 *      (no React component import — email templates use inline HTML).
 *   3. (V1.8) `/library/[slug]/page.tsx` — IF Mark Douglas cards ever expose
 *      AI-generated paraphrases (currently all paraphrases are human-written
 *      so the banner is NOT needed there V1.7).
 *
 * Posture Mark Douglas (anti-anthropomorphization) :
 *   - NEVER write "Claude pense que..." / "L IA recommande..." in body copy.
 *   - The banner explicitly says "ne remplace ni un coaching humain" — Eliot
 *     stays the human coach ; the AI is an executor of his prompt.
 *
 * Accessibility :
 *   - `role="note"` so screen readers announce the disclaimer as a note,
 *     not a generic block of text.
 *   - `aria-label` explicit ("Avis sur le contenu généré par IA") so SR users
 *     know what kind of note this is before reading.
 *   - Text contrast WCAG AA via `--t-2` token on `--bg-2` background.
 */

export type AIGeneratedBannerVariant = 'inline' | 'badge';

export interface AIGeneratedBannerProps {
  /**
   * `inline` (default) — full disclaimer card, used at the top of report
   * pages. `badge` — compact pill for surfaces with limited real estate
   * (timeline rows, list items).
   */
  variant?: AIGeneratedBannerVariant;
  /**
   * Optional override of the model display name. Default reads "Claude
   * (famille Sonnet)" — anti-drift if the specific model version changes
   * over time (V2026 trigger : Sonnet 4.6 → 5.0 etc.).
   */
  modelName?: string;
  /**
   * Optional class name pass-through for parent layout control.
   */
  className?: string;
}

const DEFAULT_MODEL_NAME = 'Claude (famille Sonnet)';

/**
 * Render the AI-generated disclaimer banner. Pure stateless component, no
 * side effects, safe to import from any Server Component or Client Component.
 */
export function AIGeneratedBanner({
  variant = 'inline',
  modelName = DEFAULT_MODEL_NAME,
  className = '',
}: AIGeneratedBannerProps): ReactNode {
  if (variant === 'badge') {
    return (
      <span
        role="note"
        aria-label="Avis sur le contenu généré par IA"
        className={`inline-flex items-center gap-1 rounded-full border border-[var(--b-default)] bg-[var(--bg-2)] px-2 py-0.5 text-xs text-[var(--t-3)] ${className}`.trim()}
      >
        <span aria-hidden="true">·</span>
        Généré par IA — pas substitut coaching humain
      </span>
    );
  }

  return (
    <aside
      role="note"
      aria-label="Avis sur le contenu généré par IA"
      className={`rounded-lg border-l-4 border-[var(--cy)] bg-[var(--bg-2)] px-4 py-3 text-sm text-[var(--t-2)] ${className}`.trim()}
    >
      <p>
        Ce rapport est généré par une intelligence artificielle ({modelName}, Anthropic). Il ne
        remplace ni un coaching humain, ni un avis médical, ni un conseil en investissement
        personnalisé.{' '}
        {/* V1.9 TIER A : link to /legal/ai-disclosure closes EU AI Act §50
            transparency loop (page shipped PR #67 2026-05-14). */}
        <a
          href="/legal/ai-disclosure"
          className="font-medium text-[var(--t-1)] underline decoration-[var(--cy)] decoration-2 underline-offset-2 transition-colors hover:text-[var(--acc)] focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none"
        >
          En savoir plus →
        </a>
      </p>
    </aside>
  );
}
