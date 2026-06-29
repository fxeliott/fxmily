import { describe, expect, it } from 'vitest';

import {
  assetAnchorId,
  assetCountLabel,
  biasMeta,
  buildVimeoEmbedUrl,
  deriveSeanceTime,
  deriveSeanceTitle,
  formatDuration,
  slotMeta,
  symbolSlug,
} from './derive';

describe('buildVimeoEmbedUrl — iframe src injection defence (defence-in-depth w/ CSP)', () => {
  it('trusts a precomputed URL only when it is https://player.vimeo.com', () => {
    const url = 'https://player.vimeo.com/video/123?h=abc&dnt=1';
    expect(buildVimeoEmbedUrl(null, null, url)).toBe(url);
  });

  it('rejects an off-host precomputed URL and falls through to id-based build', () => {
    const out = buildVimeoEmbedUrl('999', null, 'https://evil.com/video/123');
    expect(out).toContain('https://player.vimeo.com/video/999');
    expect(out).not.toContain('evil.com');
  });

  it('rejects http:// (non-TLS) precomputed and falls through', () => {
    const out = buildVimeoEmbedUrl('999', null, 'http://player.vimeo.com/video/123');
    expect(out).toContain('https://player.vimeo.com/video/999');
  });

  it('rejects a javascript: precomputed URL', () => {
     
    expect(buildVimeoEmbedUrl(null, null, 'javascript:alert(1)')).toBeNull();
  });

  it('rejects a data: precomputed URL', () => {
    expect(buildVimeoEmbedUrl(null, null, 'data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects a malformed precomputed URL', () => {
    expect(buildVimeoEmbedUrl(null, null, 'not a url at all')).toBeNull();
  });

  it('builds an RGPD-safe embed URL from an id (dnt=1, chrome stripped)', () => {
    const out = buildVimeoEmbedUrl('123', null, null);
    expect(out).toContain('https://player.vimeo.com/video/123?');
    expect(out).toContain('dnt=1');
    expect(out).toContain('title=0');
    expect(out).toContain('byline=0');
    expect(out).toContain('portrait=0');
  });

  it('appends the private hash when provided', () => {
    const out = buildVimeoEmbedUrl('123', 'deadbeef', null);
    expect(out).toContain('h=deadbeef');
  });

  it('returns null (degraded "replay indisponible") when no id and no valid url', () => {
    expect(buildVimeoEmbedUrl(null, null, null)).toBeNull();
  });
});

describe('symbolSlug / assetAnchorId — keeps the SVG accessible name intact', () => {
  it('passes a clean symbol through', () => {
    expect(symbolSlug('DXY')).toBe('DXY');
  });

  it('strips a space so a multi-word symbol cannot split the id-list', () => {
    expect(symbolSlug('SP 500')).toBe('SP500');
  });

  it('strips slashes and punctuation', () => {
    expect(symbolSlug('EUR/USD')).toBe('EURUSD');
  });

  it('falls back to "x" on an all-invalid symbol', () => {
    expect(symbolSlug('@#$')).toBe('x');
    expect(symbolSlug('')).toBe('x');
  });

  it('prefixes the anchor id', () => {
    expect(assetAnchorId('SP 500')).toBe('actif-SP500');
  });
});

describe('biasMeta — tolerant normalisation, degrades to neutre (never throws)', () => {
  it('maps haussier / long / bull to ok-up', () => {
    for (const v of ['haussier', 'long', 'bull', 'HAUSSIER']) {
      expect(biasMeta(v)).toEqual({ tone: 'ok', label: 'Haussier', dir: 'up' });
    }
  });

  it('maps baissier / short / bear to bad-down', () => {
    for (const v of ['baissier', 'short', 'bear']) {
      expect(biasMeta(v)).toEqual({ tone: 'bad', label: 'Baissier', dir: 'down' });
    }
  });

  it('degrades unknown / null / undefined to neutre-flat', () => {
    for (const v of ['neutre', 'wat', null, undefined]) {
      expect(biasMeta(v)).toEqual({ tone: 'mute', label: 'Neutre', dir: 'flat' });
    }
  });
});

describe('formatDuration — FR duration formatting + null guards', () => {
  it('returns null for absent / non-positive input', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(-5)).toBeNull();
  });

  it('formats sub-hour as minutes', () => {
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(1500)).toBe('25 min');
  });

  it('formats exact hours without minutes', () => {
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(7200)).toBe('2 h');
  });

  it('zero-pads the minute part past the hour', () => {
    expect(formatDuration(3660)).toBe('1 h 01');
    expect(formatDuration(5400)).toBe('1 h 30');
  });
});

describe('slotMeta — slot accent (WCAG-critical text token)', () => {
  it('analyse uses the brand --acc for text', () => {
    const m = slotMeta('analyse');
    expect(m.label).toBe('Analyse');
    expect(m.accentText).toBe('var(--acc)');
  });

  it('debrief uses --acc-2-hi for text (AA floor; --acc-2 would fail in dark)', () => {
    const m = slotMeta('debrief');
    expect(m.label).toBe('Débrief');
    expect(m.accentText).toBe('var(--acc-2-hi)');
    // The decorative rail keeps the saturated tone (no contrast floor).
    expect(m.accentVar).toBe('var(--acc-2)');
  });
});

describe('assetCountLabel / deriveSeance* — display fallbacks', () => {
  it('pluralises the asset count', () => {
    expect(assetCountLabel(0)).toBe('0 actif');
    expect(assetCountLabel(1)).toBe('1 actif');
    expect(assetCountLabel(3)).toBe('3 actifs');
  });

  it('derives the default per-slot time', () => {
    expect(deriveSeanceTime('analyse')).toBe('12h00');
    expect(deriveSeanceTime('debrief')).toBe('20h00');
  });

  it('derives a title from date + slot (slot long + day)', () => {
    const title = deriveSeanceTitle('2026-06-29', 'analyse');
    expect(title.startsWith('Analyse de séance du ')).toBe(true);
    expect(title).toContain('29');
  });
});
