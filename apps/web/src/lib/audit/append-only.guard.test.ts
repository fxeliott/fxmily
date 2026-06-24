import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * GARDE-FOU APPEND-ONLY (enrichment Session 1 « event-log sans écrasement »).
 *
 * Les journaux `AuditLog` et `ScoreEvent` sont insert-only : leur schéma n'a pas
 * d'`updatedAt`, mais Prisma autorise quand même `.update()` — le schéma seul ne
 * garantit donc pas l'invariant. Ce test scanne le code source et casse le build
 * si quelqu'un mute une ligne de ces journaux en place (`update`/`updateMany`/
 * `upsert`). Insertions (`create`/`createMany`) et purge RGPD groupée
 * (`delete`/`deleteMany`) restent autorisées.
 *
 * @see ./APPEND-ONLY.md — le contrat complet (pourquoi + quels modèles)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(HERE, '../..'); // src/lib/audit → src

/** Accesseurs Prisma des journaux append-only + mutations interdites. */
const FORBIDDEN = /\b(auditLog|scoreEvent)\.(update|updateMany|upsert)\b/;

// `generated` = client Prisma généré (ses JSDoc montrent `prisma.x.update(...)`
// en exemple — ce n'est pas du code applicatif, on ne le scanne pas).
const SKIP_DIRS = new Set(['node_modules', '.next', '__snapshots__', 'generated']);

/** Liste récursive des fichiers .ts/.tsx de prod (hors tests) sous `dir`. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectSourceFiles(join(dir, entry.name), acc);
      continue;
    }
    const name = entry.name;
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
    if (name.endsWith('.ts') || name.endsWith('.tsx')) acc.push(join(dir, name));
  }
  return acc;
}

describe('event-log append-only — garde-fou anti-écrasement', () => {
  const files = collectSourceFiles(SRC_ROOT);

  it('scanne un corpus de sources non trivial (sanity du walk)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('aucun `.update`/`.updateMany`/`.upsert` sur AuditLog ou ScoreEvent', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (FORBIDDEN.test(line)) {
          offenders.push(`${file.slice(SRC_ROOT.length + 1)}:${i + 1} → ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `Mutation en place d'un journal append-only :\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
