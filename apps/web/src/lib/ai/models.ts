/**
 * Catalogue des modèles Claude — SSOT TypeScript (Session 1 Fondations).
 *
 * POURQUOI CE MODULE. L'allowlist des slugs de modèles exécutables était
 * dupliquée verbatim à TROIS endroits (le JSDoc de `claude-response.ts` et le
 * commentaire de `claude-batch-core.sh` reconnaissent eux-mêmes la triple copie
 * « à étendre ensemble à la main ») :
 *   1. `ops/scripts/lib/claude-batch-core.sh` (allowlist bash, le moteur réel) ;
 *   2. `lib/ai/claude-response.ts` (`KNOWN_CLAUDE_MODEL_SLUGS`) ;
 *   3. `lib/env.ts` (refine inline de `ANTHROPIC_MODEL`).
 * Ce module fige LA copie TS unique : `claude-response.ts` et `env.ts` la
 * consomment désormais au lieu de la redéclarer. La parité avec l'allowlist bash
 * (qui vit hors du graphe d'import TS) est verrouillée par `models.parity.test.ts`,
 * qui lit le shell à l'exécution et casse le build si les deux divergent.
 *
 * PURETÉ VOLONTAIRE. Aucun `import 'server-only'`, aucun accès `process.env`,
 * aucune dépendance — pour que `env.ts` (server-only, jamais bundlé client) ET
 * `claude-response.ts` (server-only) puissent l'importer sans cycle ni
 * contamination, et qu'un futur composant d'affichage puisse réutiliser la liste
 * sans tirer de code serveur.
 *
 * @see ops/scripts/lib/claude-batch-core.sh — l'allowlist bash miroir (moteur)
 * @see lib/ai/models.parity.test.ts — le test qui verrouille bash ↔ TS ↔ env
 */

/**
 * Slugs de modèles Claude EXÉCUTABLES connus — l'unique source de vérité TS.
 *
 * Typé `readonly string[]` (et NON `as const`) à dessein : les appelants
 * existants font `.includes(uneVariableString)` (refine de `env.ts`, coercion
 * des tables de pricing), ce qui ne compile pas si le tableau est un tuple de
 * littéraux. Le type littéral est porté séparément par `ClaudeModelSlug`, et la
 * synchronisation tableau ↔ union est prouvée par `models.parity.test.ts`.
 *
 * Exclut le sentinel `claude-code-local` exprès (cf. {@link CLAUDE_LOCAL_SENTINEL}).
 */
export const KNOWN_CLAUDE_MODEL_SLUGS: readonly string[] = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

/** Union littérale des slugs ci-dessus (parité vérifiée par le test de parité). */
export type ClaudeModelSlug =
  | 'claude-fable-5'
  | 'claude-opus-4-8'
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5';

/**
 * Repli honnête pour un `model` reçu sur le fil qui n'est PAS un slug connu :
 * le contenu a été généré par le binaire Max local, modèle exact non attribué.
 * Miroir de `CLAUDE_CODE_LOCAL_MODEL` dans les tables de pricing. Ce n'est JAMAIS
 * un slug exécutable — il ne figure donc pas dans {@link KNOWN_CLAUDE_MODEL_SLUGS}.
 */
export const CLAUDE_LOCAL_SENTINEL = 'claude-code-local';

/**
 * Défaut de `ANTHROPIC_MODEL` (chemin SDK dormant). Le moins cher de la liste —
 * un drift accidentel ne doit jamais facturer un Opus par défaut. Consommé par
 * `env.ts` (`.default(...)`).
 */
export const DEFAULT_ANTHROPIC_MODEL: ClaudeModelSlug = 'claude-sonnet-4-6';

/** Garde de type : `value` est-il un slug de modèle Claude connu et exécutable ? */
export function isKnownClaudeModel(value: string): value is ClaudeModelSlug {
  return KNOWN_CLAUDE_MODEL_SLUGS.includes(value);
}
