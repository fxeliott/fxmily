import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CLAUDE_LOCAL_SENTINEL,
  DEFAULT_ANTHROPIC_MODEL,
  isKnownClaudeModel,
  KNOWN_CLAUDE_MODEL_SLUGS,
  type ClaudeModelSlug,
} from './models';

/**
 * VERROU DE PARITÉ — l'allowlist des modèles Claude existe à trois endroits qui
 * doivent rester synchronisés (le moteur bash, la SSOT TS, le refine env). Le
 * bash vit HORS du graphe d'import TS : sans ce test, une dérive (modèle ajouté
 * d'un côté, oublié de l'autre) passe silencieusement. Ici on lit le shell à
 * l'exécution et on prouve l'égalité ensembliste — le contrat que le JSDoc
 * demandait jusqu'ici de tenir « à la main ».
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// .../apps/web/src/lib/ai → remonte de 5 niveaux jusqu'à la racine du monorepo.
const REPO_ROOT = resolve(HERE, '../../../../..');
const BATCH_CORE_SH = resolve(REPO_ROOT, 'ops/scripts/lib/claude-batch-core.sh');

/** Slugs de modèles déclarés dans l'allowlist du moteur bash. */
function parseShellAllowlist(): readonly string[] {
  const sh = readFileSync(BATCH_CORE_SH, 'utf8');
  // La ligne d'allowlist joint les slugs par `|` (ex. `claude-x|claude-y`).
  const allowlistLine = sh
    .split('\n')
    .find((line) => /claude-[a-z0-9-]+\|claude-[a-z0-9-]+/.test(line));
  if (allowlistLine === undefined) {
    throw new Error(`Allowlist pipe-séparée introuvable dans ${BATCH_CORE_SH}`);
  }
  return [...allowlistLine.matchAll(/claude-[a-z0-9-]+/g)]
    .map((m) => m[0])
    .filter((slug) => slug !== CLAUDE_LOCAL_SENTINEL); // jamais un slug exécutable
}

describe('catalogue de modèles Claude — parité bash ↔ TS', () => {
  it("l'allowlist bash (claude-batch-core.sh) est identique à la SSOT TS", () => {
    const shell = [...new Set(parseShellAllowlist())].sort();
    const ts = [...KNOWN_CLAUDE_MODEL_SLUGS].sort();
    expect(shell).toEqual(ts);
  });

  it('le défaut bash CLAUDE_MODEL est un slug connu de la SSOT TS', () => {
    const sh = readFileSync(BATCH_CORE_SH, 'utf8');
    const match = /CLAUDE_MODEL="\$\{FXMILY_CLAUDE_MODEL:-([a-z0-9-]+)\}"/.exec(sh);
    expect(match?.[1], 'défaut CLAUDE_MODEL introuvable dans le shell').toBeDefined();
    expect(KNOWN_CLAUDE_MODEL_SLUGS).toContain(match?.[1]);
  });
});

describe('catalogue de modèles Claude — cohérence interne', () => {
  it('la liste runtime et le type littéral ClaudeModelSlug sont synchronisés', () => {
    // EXPECTED est typé ClaudeModelSlug[] : si un slug est ajouté au tableau sans
    // l'être à l'union (ou l'inverse), soit ce fichier ne compile plus, soit
    // l'égalité ci-dessous échoue. Double garde compile-time + runtime.
    const EXPECTED: ClaudeModelSlug[] = [
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ];
    expect([...EXPECTED].sort()).toEqual([...KNOWN_CLAUDE_MODEL_SLUGS].sort());
  });

  it('ne contient aucun doublon', () => {
    expect(new Set(KNOWN_CLAUDE_MODEL_SLUGS).size).toBe(KNOWN_CLAUDE_MODEL_SLUGS.length);
  });

  it('exclut le sentinel local (jamais un slug exécutable)', () => {
    expect(KNOWN_CLAUDE_MODEL_SLUGS).not.toContain(CLAUDE_LOCAL_SENTINEL);
    expect(isKnownClaudeModel(CLAUDE_LOCAL_SENTINEL)).toBe(false);
  });

  it('isKnownClaudeModel reconnaît chaque slug connu et rejette les inconnus', () => {
    for (const slug of KNOWN_CLAUDE_MODEL_SLUGS) {
      expect(isKnownClaudeModel(slug), slug).toBe(true);
    }
    expect(isKnownClaudeModel('gpt-4o')).toBe(false);
    expect(isKnownClaudeModel('')).toBe(false);
  });

  it('le défaut ANTHROPIC_MODEL est un slug connu (le moins cher)', () => {
    expect(isKnownClaudeModel(DEFAULT_ANTHROPIC_MODEL)).toBe(true);
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-sonnet-4-6');
  });
});
