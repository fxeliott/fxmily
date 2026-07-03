import { describe, expect, it } from 'vitest';

import {
  assembleSeanceContent,
  CANONICAL_ASSETS,
  CANONICAL_SYMBOLS,
  hasAiAttribution,
  hasEmoji,
  type PipelineContentInput,
} from './pipeline-canonical';

/**
 * Réunion hub (séances) J4 — Règle n°1 re-validation at the Fxmily ingest
 * boundary. These prove the SAME guarantees the standalone `assembleContent`
 * gave (faithful port): exactly 6 canonical assets/6 messages, identities
 * INJECTED from canon (never trusted), emoji-free, AI-attribution-free.
 */

/** Build a faithful 6-asset/6-message payload (one per canonical symbol). */
function validContent(overrides: Partial<PipelineContentInput> = {}): PipelineContentInput {
  return {
    summary: "Séance d'analyse du matin, fil conducteur macro.",
    keyTakeaways: ['Contexte dollar ferme', 'Patience avant le NFP'],
    assets: CANONICAL_ASSETS.map((a) => ({
      symbol: a.symbol,
      bias: 'neutre',
      levels: [{ label: 'Support', value: '1.0800' }],
      reading: [`Lecture fidèle pour ${a.symbol}.`],
    })),
    messages: CANONICAL_ASSETS.map((a) => ({ asset: a.symbol, text: `${a.symbol} : RAS.` })),
    ...overrides,
  };
}

describe('assembleSeanceContent — happy path', () => {
  it('accepts a faithful 6-asset / 6-message payload', () => {
    const res = assembleSeanceContent(validContent());
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.content.assets).toHaveLength(6);
    expect(res.content.messages).toHaveLength(6);
  });

  it('injects identities (name/macro) from canon — never from the payload', () => {
    // The input shape carries NO name/macro; the canon is authoritative.
    const res = assembleSeanceContent(validContent());
    const dxy = res.content.assets.find((a) => a.symbol === 'DXY');
    expect(dxy?.name).toBe('Indice dollar');
    expect(dxy?.macro).toBe(true);
    const eur = res.content.assets.find((a) => a.symbol === 'EURUSD');
    expect(eur?.name).toBe('Euro / Dollar');
    expect(eur?.macro).toBe(false);
    // Order preserved: DXY is always the 6th (macro pivot).
    expect(res.content.assets.map((a) => a.symbol)).toEqual([...CANONICAL_SYMBOLS]);
    expect(res.content.assets[5]?.symbol).toBe('DXY');
  });

  it('keeps the levels the pipeline stated, trims, drops empties', () => {
    const res = assembleSeanceContent(
      validContent({
        assets: CANONICAL_ASSETS.map((a) => ({
          symbol: a.symbol,
          bias: 'haussier',
          levels: [
            { label: '  Objectif  ', value: ' 1.1000 ' },
            { label: '', value: 'x' }, // dropped (empty label)
          ],
          reading: ['  ok  '],
        })),
      }),
    );
    expect(res.ok).toBe(true);
    expect(res.content.assets[0]?.levels).toEqual([{ label: 'Objectif', value: '1.1000' }]);
    expect(res.content.assets[0]?.reading).toEqual(['ok']);
  });
});

describe('assembleSeanceContent — typography belt (F-J1, em/en dash strip)', () => {
  it('strips em/en dashes from summary / keyTakeaways / reading / levels / messages', () => {
    const res = assembleSeanceContent(
      validContent({
        summary: 'Analyse de séance — un dollar qui souffle.',
        keyTakeaways: ['Range 3–5R visé', 'Discipline — priorité'],
        assets: CANONICAL_ASSETS.map((a) => ({
          symbol: a.symbol,
          bias: 'neutre',
          levels: [{ label: 'Zone—clé', value: '1.0800–1.0850' }],
          reading: [`Lecture ${a.symbol} — biais neutre.`],
        })),
        messages: CANONICAL_ASSETS.map((a) => ({
          asset: a.symbol,
          text: `${a.symbol} — rien à signaler.`,
        })),
      }),
    );
    expect(res.ok).toBe(true);
    const blob = JSON.stringify(res.content);
    expect(blob).not.toMatch(/[–—]/);
    expect(res.content.summary).toBe('Analyse de séance : un dollar qui souffle.');
    expect(res.content.keyTakeaways).toEqual(['Range 3 à 5R visé', 'Discipline : priorité']);
    expect(res.content.assets[0]?.levels).toEqual([
      { label: 'Zone, clé', value: '1.0800 à 1.0850' },
    ]);
    expect(res.content.assets[0]?.reading[0]).toBe('Lecture EURUSD : biais neutre.');
    expect(res.content.messages[0]?.text).toBe('EURUSD : rien à signaler.');
  });

  it('leaves dash-free content byte-for-byte unchanged', () => {
    const res = assembleSeanceContent(validContent());
    expect(res.ok).toBe(true);
    expect(res.content.summary).toBe("Séance d'analyse du matin, fil conducteur macro.");
    expect(res.content.messages[0]?.text).toBe('EURUSD : RAS.');
  });
});

describe('assembleSeanceContent — Règle n°1 rejections', () => {
  it('rejects a missing canonical asset', () => {
    const c = validContent();
    const res = assembleSeanceContent({ ...c, assets: c.assets!.slice(0, 5) });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('actif manquant: DXY'))).toBe(true);
  });

  it('rejects a missing message', () => {
    const c = validContent();
    const res = assembleSeanceContent({ ...c, messages: c.messages!.slice(0, 5) });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('message manquant'))).toBe(true);
  });

  it('rejects an empty reading', () => {
    const c = validContent();
    const assets = c.assets!.map((a, i) => (i === 0 ? { ...a, reading: ['  '] } : a));
    const res = assembleSeanceContent({ ...c, assets });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('lecture (reading) vide'))).toBe(true);
  });

  it('rejects an invalid bias', () => {
    const c = validContent();
    const assets = c.assets!.map((a, i) => (i === 0 ? { ...a, bias: 'long' } : a));
    const res = assembleSeanceContent({ ...c, assets });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('biais invalide'))).toBe(true);
  });

  it('rejects an emoji anywhere in the published text', () => {
    const res = assembleSeanceContent(validContent({ summary: 'Bon plan 🚀 ce matin.' }));
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('emoji detecte (interdit)');
  });

  it('rejects a regional-flag / keycap composed emoji (mechanical 0-emoji)', () => {
    expect(hasEmoji('drapeau 🇫🇷')).toBe(true);
    expect(hasEmoji('touche 1️⃣')).toBe(true);
  });

  it('allows sober glyphs (→ ↑ ↓ ·) — not emoji', () => {
    expect(hasEmoji('biais ↑ vers 1.1000 · cible →')).toBe(false);
  });

  it('rejects an AI self-attribution signature', () => {
    const res = assembleSeanceContent(
      validContent({ summary: 'Cette analyse a été rédigée par Claude.' }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('auto-attribution a une IA detectee (interdit)');
  });

  it('does NOT flag a faithful topical mention of an AI tool', () => {
    // Règle n°1: a reported remark about the trader's own process is content.
    expect(hasAiAttribution("j'utilise un assistant IA pour mes captures")).toBe(false);
  });
});
