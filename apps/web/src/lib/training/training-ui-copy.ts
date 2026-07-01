/**
 * S8 RE-CHALLENGE — single source for the app-PRODUCED *example* copy on the
 * training surface (placeholders that teach a member/admin what to write).
 *
 * 🚨 GARDE-FOU §2 (SPEC posture invariant): app-produced content must NEVER
 * give trade-analysis advice (direction / setup / level / forecast). These
 * example placeholders are the highest-risk strings because they EXEMPLIFY the
 * expected input — a careless future edit could smuggle market analysis into
 * one and it would reach a member/admin. Centralising them here lets
 * `training-ui-copy.guardrail.test.ts` run every string through the production
 * `detectAMFViolation` (the same detector the AI-output gate uses), so such an
 * edit FAILS CI instead of shipping.
 *
 * Scope = EXAMPLE copy only (psychology / discipline / process framing). A
 * member's / admin's actual free-text is exempt from §2 (human authored) and is
 * not represented here. Pure-numeric placeholders ("2", "1.8") carry no §2 risk
 * and are intentionally left inline.
 */
export const TRAINING_UI_COPY = {
  /** Admin annotation textarea (the correction the admin writes). Process /
   * psychology framing only — never a market call on the screenshot. */
  annotationPlaceholder:
    "Ex. R:R 1:2 prévu, mais entrée anticipée avant la confirmation. Travaille la patience d'exécution (cf. fiche Douglas « attendre son setup »).",

  /** Wizard "Leçon tirée" textarea — what the backtest taught about the
   * member's PROCESS, not about the market. */
  lessonLearnedPlaceholder:
    "Ex : j'ai attendu la confirmation au lieu d'anticiper, l'entrée était plus propre.",

  /** Member reply to an admin correction — acknowledges the process work. */
  replyPlaceholder:
    "Ex. Compris, je vais travailler ma patience d'exécution sur les prochains backtests.",

  /** Backtest-session label example — names instrument/period as a neutral
   * tag, never a direction (« Range GBPUSD », not « GBPUSD haussier »). */
  sessionLabelPlaceholder: 'Ex : Range GBPUSD · janvier 2024',
} as const;

export type TrainingUiCopyKey = keyof typeof TRAINING_UI_COPY;
