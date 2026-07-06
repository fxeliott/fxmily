import { describe, expect, it } from 'vitest';

// Guardrail unit + LIVE-repo coverage for the E2E copy-sync check
// (`scripts/check-e2e-copy-sync.mjs`). The pure helpers are tested against
// synthetic inputs (so the extraction, normalisation, dynamic-fragment and
// seeded-data branches are provably correct — and the check provably CATCHES a
// real orphan, not a rubber stamp), and the LIVE tree is asserted clean so this
// test flips red the moment a spec asserts copy the app no longer ships.
//
// Cross-package import (apps/web/src/lib/quality → repo root), same shape as
// `../cron/crontab-sync.test.ts`.
import {
  checkE2eCopySync,
  extractSpecLiterals,
  isCopyLiteral,
  literalHasSourceHome,
  normalizeCopy,
  stableFragments,
} from '../../../../../scripts/check-e2e-copy-sync.mjs';

describe('isCopyLiteral', () => {
  it('accepts a multi-word sentence-length literal', () => {
    expect(isCopyLiteral('Enregistrer mon matin')).toBe(true);
  });
  it('rejects a short label, a single word, and an ARIA role', () => {
    expect(isCopyLiteral('Oui')).toBe(false);
    expect(isCopyLiteral('combobox')).toBe(false);
    expect(isCopyLiteral('button')).toBe(false);
  });
});

describe('normalizeCopy', () => {
  it('decodes JSX apostrophe/ampersand entities so source ↔ spec compare equal', () => {
    expect(normalizeCopy('Vue d&apos;ensemble &amp; biais')).toBe("Vue d'ensemble & biais");
  });
  it('unifies curly quotes and collapses whitespace', () => {
    expect(normalizeCopy('Ton\n  motif ')).toBe('Ton motif');
    expect(normalizeCopy('l’analyse')).toBe("l'analyse");
  });
});

describe('stableFragments', () => {
  it('keeps the static run around a numeric interpolation', () => {
    expect(stableFragments('1 écart à regarder')).toContain('écart à regarder');
  });
  it('keeps the prefix before a `:` interpolation boundary', () => {
    expect(stableFragments('Ton motif : Coupure internet déclarée')).toContain('Ton motif');
  });
});

describe('extractSpecLiterals', () => {
  it('pulls literals from getByText / name: option, ignores regex + short labels', () => {
    const src = `
      page.getByText('Check-in matin enregistré');
      page.getByRole('button', { name: 'Enregistrer mon matin' });
      page.getByText(/Sommeil/i);
      page.getByRole('button', { name: 'Oui' });
    `;
    const literals = extractSpecLiterals(src).map((e) => e.literal);
    expect(literals).toContain('Check-in matin enregistré');
    expect(literals).toContain('Enregistrer mon matin');
    expect(literals).not.toContain('Oui'); // too short
    expect(literals.some((l) => /Sommeil/.test(l))).toBe(false); // regex ignored
  });

  it('marks a literal that ALSO appears as seeded fixture data (seeded=true)', () => {
    const src = `
      const label = 'Backtest XAUUSD decembre seed';
      page.getByText('Backtest XAUUSD decembre seed');
    `;
    const seeded = extractSpecLiterals(src).find((e) => e.literal.startsWith('Backtest'));
    expect(seeded?.seeded).toBe(true);
  });
});

describe('literalHasSourceHome', () => {
  const haystack = normalizeCopy(
    `<p>Ton motif : {reason}</p> <span>écart à regarder</span> <h2>Enregistrer mon matin</h2>`,
  );
  it('finds an exact literal', () => {
    expect(literalHasSourceHome('Enregistrer mon matin', haystack)).toBe(true);
  });
  it('finds dynamic copy via its static prefix/fragment', () => {
    expect(literalHasSourceHome('Ton motif : quelque chose', haystack)).toBe(true);
    expect(literalHasSourceHome('3 écart à regarder', haystack)).toBe(true);
  });
  it('reports a genuinely absent literal as an orphan (NOT a rubber stamp)', () => {
    expect(literalHasSourceHome('Texte qui a totalement disparu', haystack)).toBe(false);
  });
});

describe('checkE2eCopySync — LIVE repo (regression net)', () => {
  it('every E2E copy literal still has a home in apps/web/src', () => {
    const orphans = checkE2eCopySync();
    expect(
      orphans.length,
      orphans.length === 0
        ? ''
        : [
            'E2E specs assert copy no longer found in src (source is the source of truth):',
            ...orphans.map((o) => `  ${o.file} → «${o.literal}»`),
            'Fix: update the spec literal to the current source copy, or use a regex if dynamic.',
          ].join('\n'),
    ).toBe(0);
  });
});
