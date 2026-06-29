import { describe, expect, it } from 'vitest';

import { buildLadder, isPriceLike, parseNums, type RawLevel } from './levels-schema';

describe('parseNums — number extraction (comma decimal → dot)', () => {
  it('parses a single FR-decimal price', () => {
    expect(parseNums('101,8')).toEqual([101.8]);
  });

  it('parses both endpoints of a range', () => {
    expect(parseNums('100 - 105')).toEqual([100, 105]);
  });

  it('parses a negative value', () => {
    expect(parseNums('-0,5')).toEqual([-0.5]);
  });

  it('returns [] when the string carries no number', () => {
    expect(parseNums('aucun niveau annoncé')).toEqual([]);
  });

  it('extracts every number it can see (gating is isPriceLike’s job, not this one)', () => {
    expect(parseNums('cassure de 2024 vers 2400')).toEqual([2024, 2400]);
  });
});

describe('isPriceLike — the anti-prose gate (Règle n°1)', () => {
  it('accepts a bare price', () => {
    expect(isPriceLike('101,8')).toBe(true);
  });

  it('accepts a comparator-prefixed price', () => {
    expect(isPriceLike('< 100')).toBe(true);
    expect(isPriceLike('≤ 2400')).toBe(true);
  });

  it('accepts a range', () => {
    expect(isPriceLike('100 - 105')).toBe(true);
  });

  it('accepts a price followed by a NON-numeric annotation', () => {
    // Leading token is a price; the trailing "(support clé)" has no digit.
    expect(isPriceLike('101,8 (support clé)')).toBe(true);
  });

  it('rejects prose that merely contains a number', () => {
    // Does not START with a price token.
    expect(isPriceLike('cassure du plus haut de 2024 vers 2400')).toBe(false);
  });

  it('rejects a price token trailed by another digit (multi-number prose)', () => {
    expect(isPriceLike('100 puis 200')).toBe(false);
  });

  it('rejects a label with no number at all', () => {
    expect(isPriceLike('objectif')).toBe(false);
    expect(isPriceLike('')).toBe(false);
  });
});

describe('buildLadder — the <2-distinct fidelity guard', () => {
  it('returns null on empty / nullish levels', () => {
    expect(buildLadder(null, 'haussier')).toBeNull();
    expect(buildLadder(undefined, 'haussier')).toBeNull();
    expect(buildLadder([], 'haussier')).toBeNull();
  });

  it('returns null when only ONE distinct price is stated (cannot scale)', () => {
    const levels: RawLevel[] = [{ label: 'Support', value: '100' }];
    expect(buildLadder(levels, 'haussier')).toBeNull();
  });

  it('returns null when two levels carry the SAME price (no span)', () => {
    const levels: RawLevel[] = [
      { label: 'Support', value: '100' },
      { label: 'Résistance', value: '100' },
    ];
    expect(buildLadder(levels, 'neutre')).toBeNull();
  });

  it('returns null when every level is prose (no price-like value)', () => {
    const levels: RawLevel[] = [
      { label: 'Biais', value: 'haussier au-dessus de 100 mais prudence sous 90' },
      { label: 'Contexte', value: 'attendre la confirmation' },
    ];
    expect(buildLadder(levels, 'haussier')).toBeNull();
  });

  it('draws when a single range supplies two distinct endpoints', () => {
    const levels: RawLevel[] = [{ label: "Zone d'achat", value: '100 - 105' }];
    const ladder = buildLadder(levels, 'haussier');
    if (!ladder) throw new Error('expected a ladder from a 2-endpoint range');
    expect(ladder.lines).toHaveLength(1);
    const line = ladder.lines[0];
    expect(line?.isRange).toBe(true);
    expect(line?.isEntry).toBe(true);
    expect(line?.role).toBe('brand');
  });
});

describe('buildLadder — geometry + classification', () => {
  const levels: RawLevel[] = [
    { label: 'Invalidation', value: '95' },
    { label: "Zone d'achat", value: '100' },
    { label: 'Objectif', value: '110' },
  ];

  it('plots one line per price-like level, each value verbatim', () => {
    const ladder = buildLadder(levels, 'haussier');
    if (!ladder) throw new Error('expected a ladder');
    expect(ladder.lines).toHaveLength(3);
    expect(ladder.lines.map((l) => l.rawValue)).toEqual(['95', '100', '110']);
  });

  it('maps the normalised bias to a direction cue (never colour alone)', () => {
    expect(buildLadder(levels, 'haussier')?.biasDir).toBe('up');
    expect(buildLadder(levels, 'baissier')?.biasDir).toBe('down');
    expect(buildLadder(levels, 'neutre')?.biasDir).toBe('flat');
    expect(buildLadder(levels, undefined)?.biasDir).toBe('flat');
  });

  it('classifies labels into roles accent-insensitively', () => {
    const ladder = buildLadder(levels, 'haussier');
    if (!ladder) throw new Error('expected a ladder');
    const byLabel = (name: string) => ladder.lines.find((l) => l.label === name);
    expect(byLabel('Invalidation')?.role).toBe('bear');
    expect(byLabel("Zone d'achat")?.role).toBe('brand');
    expect(byLabel('Objectif')?.role).toBe('bull');
  });

  it('keeps every plotted y inside the SVG canvas', () => {
    const ladder = buildLadder(levels, 'haussier');
    if (!ladder) throw new Error('expected a ladder');
    for (const line of ladder.lines) {
      expect(Number.isFinite(line.y)).toBe(true);
      expect(line.y).toBeGreaterThanOrEqual(0);
      expect(line.y).toBeLessThanOrEqual(ladder.height);
    }
  });

  it('de-overlaps crowded labels by at least MIN_GAP (22px)', () => {
    // Three prices 1 unit apart map to near-identical y → labels must be spread.
    const crowded: RawLevel[] = [
      { label: 'A', value: '100' },
      { label: 'B', value: '101' },
      { label: 'C', value: '102' },
    ];
    const ladder = buildLadder(crowded, 'neutre');
    if (!ladder) throw new Error('expected a ladder');
    const ys = ladder.lines.map((l) => l.labelY).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1) {
      const prev = ys[i - 1];
      const cur = ys[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur - prev).toBeGreaterThanOrEqual(22 - 0.001);
    }
  });
});
