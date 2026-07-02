import { describe, expect, it } from 'vitest';

import {
  TRAINING_LESSON_MAX,
  TRAINING_TRADINGVIEW_URL_MAX,
  trainingTradeCreateSchema,
} from './training-trade';

/** A fully-valid backtest payload; override one field per test. */
function valid(overrides: Record<string, unknown> = {}) {
  return {
    pair: 'EURUSD',
    tradingViewUrl: 'https://www.tradingview.com/x/NQe0OrXz/',
    plannedRR: 2.5,
    outcome: 'win',
    resultR: 1.8,
    systemRespected: true,
    lessonLearned: 'Respecté le plan, entrée patiente sur retest.',
    enteredAt: '2026-05-10T10:00:00.000Z',
    ...overrides,
  };
}

describe('trainingTradeCreateSchema', () => {
  it('accepts a fully-valid backtest', () => {
    expect(trainingTradeCreateSchema.safeParse(valid()).success).toBe(true);
  });

  // ----- pair (mirror Trade.pair allowlist) -----

  it('uppercases a lowercase pair', () => {
    const parsed = trainingTradeCreateSchema.parse(valid({ pair: 'eurusd' }));
    expect(parsed.pair).toBe('EURUSD');
  });

  it('rejects a non-allowlisted pair', () => {
    expect(trainingTradeCreateSchema.safeParse(valid({ pair: 'BTCUSD' })).success).toBe(false);
  });

  // ----- entryScreenshotKey (mirror annotation key regex from keys.ts) -----

  it('accepts a well-formed training storage key', () => {
    expect(
      trainingTradeCreateSchema.safeParse(
        valid({ entryScreenshotKey: 'training/zzzz9999/Ab_cd-ef12ghij.webp' }),
      ).success,
    ).toBe(true);
  });

  it('rejects a malformed / foreign-prefix storage key', () => {
    expect(
      trainingTradeCreateSchema.safeParse(
        valid({ entryScreenshotKey: 'trades/abcdefgh12345678/abcdefghijkl1234.jpg' }),
      ).success,
    ).toBe(false);
  });

  // ----- tradingViewUrl (J1 — REQUIRED, https + tradingview.com host allowlist) -----

  it('rejects a backtest with NO tradingViewUrl (omitted — the field is now required)', () => {
    const { tradingViewUrl: _t, ...rest } = valid() as Record<string, unknown>;
    expect(trainingTradeCreateSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a null tradingViewUrl (required, non-nullable)', () => {
    expect(trainingTradeCreateSchema.safeParse(valid({ tradingViewUrl: null })).success).toBe(
      false,
    );
  });

  it('rejects an empty-string tradingViewUrl with the "obligatoire" message', () => {
    const res = trainingTradeCreateSchema.safeParse(valid({ tradingViewUrl: '   ' }));
    expect(res.success).toBe(false);
  });

  it('accepts a valid TradingView snapshot link (/x/)', () => {
    const url = 'https://www.tradingview.com/x/NQe0OrXz/';
    expect(trainingTradeCreateSchema.parse(valid({ tradingViewUrl: url })).tradingViewUrl).toBe(
      url,
    );
  });

  it('accepts a valid TradingView layout link (/chart/)', () => {
    expect(
      trainingTradeCreateSchema.safeParse(
        valid({ tradingViewUrl: 'https://www.tradingview.com/chart/J1cFbGBP/' }),
      ).success,
    ).toBe(true);
  });

  it('accepts a regional sub-domain (fr.tradingview.com) and the apex host', () => {
    expect(
      trainingTradeCreateSchema.safeParse(
        valid({ tradingViewUrl: 'https://fr.tradingview.com/x/abc123/' }),
      ).success,
    ).toBe(true);
    expect(
      trainingTradeCreateSchema.safeParse(
        valid({ tradingViewUrl: 'https://tradingview.com/x/abc123/' }),
      ).success,
    ).toBe(true);
  });

  it('trims surrounding whitespace on the tradingViewUrl', () => {
    expect(
      trainingTradeCreateSchema.parse(
        valid({ tradingViewUrl: '  https://www.tradingview.com/x/abc/  ' }),
      ).tradingViewUrl,
    ).toBe('https://www.tradingview.com/x/abc/');
  });

  it('rejects an off-host link (not tradingview.com)', () => {
    expect(
      trainingTradeCreateSchema.safeParse(
        valid({ tradingViewUrl: 'https://evil.example.com/x/abc/' }),
      ).success,
    ).toBe(false);
  });

  it('rejects a look-alike host suffixing tradingview.com (open-redirect/phishing)', () => {
    expect(
      trainingTradeCreateSchema.safeParse(
        valid({ tradingViewUrl: 'https://www.tradingview.com.evil.com/x/abc/' }),
      ).success,
    ).toBe(false);
  });

  it('rejects a non-https (http) TradingView link', () => {
    expect(
      trainingTradeCreateSchema.safeParse(
        valid({ tradingViewUrl: 'http://www.tradingview.com/x/abc/' }),
      ).success,
    ).toBe(false);
  });

  it('rejects a javascript: scheme (stored-XSS guard)', () => {
    expect(
      trainingTradeCreateSchema.safeParse(
        valid({ tradingViewUrl: 'javascript:alert(document.cookie)' }),
      ).success,
    ).toBe(false);
  });

  it('rejects a data: URL', () => {
    expect(
      trainingTradeCreateSchema.safeParse(valid({ tradingViewUrl: 'data:text/html,<script>1' }))
        .success,
    ).toBe(false);
  });

  it('rejects a non-URL string', () => {
    expect(
      trainingTradeCreateSchema.safeParse(valid({ tradingViewUrl: 'pas-une-url' })).success,
    ).toBe(false);
  });

  it('rejects a tradingViewUrl carrying a bidi/zero-width char (Trojan-Source/homograph)', () => {
    expect(
      trainingTradeCreateSchema.safeParse(
        valid({ tradingViewUrl: 'https://www.tradingview.com/x/ab‮c/' }),
      ).success,
    ).toBe(false);
  });

  it('rejects a tradingViewUrl over the length cap', () => {
    const tooLong = `https://www.tradingview.com/x/${'a'.repeat(TRAINING_TRADINGVIEW_URL_MAX)}/`;
    expect(trainingTradeCreateSchema.safeParse(valid({ tradingViewUrl: tooLong })).success).toBe(
      false,
    );
  });

  // ----- plannedRR (mirror Trade.plannedRR bounds) -----

  it('rejects plannedRR below 0.25', () => {
    expect(trainingTradeCreateSchema.safeParse(valid({ plannedRR: 0.1 })).success).toBe(false);
  });

  it('rejects plannedRR above 20', () => {
    expect(trainingTradeCreateSchema.safeParse(valid({ plannedRR: 21 })).success).toBe(false);
  });

  it('coerces a numeric-string plannedRR', () => {
    const parsed = trainingTradeCreateSchema.parse(valid({ plannedRR: '3.5' }));
    expect(parsed.plannedRR).toBe(3.5);
  });

  // ----- outcome / resultR (nullable + optional — mirror Trade open/close split) -----

  it('accepts an omitted outcome and resultR', () => {
    const { outcome: _o, resultR: _r, ...rest } = valid();
    expect(trainingTradeCreateSchema.safeParse(rest).success).toBe(true);
  });

  it('accepts a null outcome and resultR', () => {
    expect(
      trainingTradeCreateSchema.safeParse(valid({ outcome: null, resultR: null })).success,
    ).toBe(true);
  });

  it('rejects an invalid outcome value', () => {
    expect(trainingTradeCreateSchema.safeParse(valid({ outcome: 'jackpot' })).success).toBe(false);
  });

  // ----- systemRespected tri-state (exact mirror of Trade.hedgeRespected) -----

  it("maps 'na' to null", () => {
    expect(trainingTradeCreateSchema.parse(valid({ systemRespected: 'na' })).systemRespected).toBe(
      null,
    );
  });

  it("maps 'true' / 'false' strings to booleans", () => {
    expect(
      trainingTradeCreateSchema.parse(valid({ systemRespected: 'true' })).systemRespected,
    ).toBe(true);
    expect(
      trainingTradeCreateSchema.parse(valid({ systemRespected: 'false' })).systemRespected,
    ).toBe(false);
  });

  it('passes a real boolean through', () => {
    expect(trainingTradeCreateSchema.parse(valid({ systemRespected: false })).systemRespected).toBe(
      false,
    );
  });

  // ----- lessonLearned (mandatory free-text, Trojan-Source canon) -----

  it('trims and NFC-normalizes lessonLearned', () => {
    const parsed = trainingTradeCreateSchema.parse(
      valid({ lessonLearned: '   bon process  \n  ' }),
    );
    expect(parsed.lessonLearned).toBe('bon process');
  });

  it('preserves internal newlines in lessonLearned', () => {
    const parsed = trainingTradeCreateSchema.parse(
      valid({ lessonLearned: 'Point 1.\n\nPoint 2.' }),
    );
    expect(parsed.lessonLearned).toBe('Point 1.\n\nPoint 2.');
  });

  it('rejects an empty lessonLearned', () => {
    expect(trainingTradeCreateSchema.safeParse(valid({ lessonLearned: '' })).success).toBe(false);
  });

  it('rejects a whitespace-only lessonLearned', () => {
    expect(trainingTradeCreateSchema.safeParse(valid({ lessonLearned: '   \n  ' })).success).toBe(
      false,
    );
  });

  it('rejects a lessonLearned over the cap', () => {
    expect(
      trainingTradeCreateSchema.safeParse(
        valid({ lessonLearned: 'a'.repeat(TRAINING_LESSON_MAX + 1) }),
      ).success,
    ).toBe(false);
  });

  it('accepts a lessonLearned exactly at the cap', () => {
    expect(
      trainingTradeCreateSchema.safeParse(valid({ lessonLearned: 'a'.repeat(TRAINING_LESSON_MAX) }))
        .success,
    ).toBe(true);
  });

  it('rejects a lessonLearned with a bidi override (U+202E, Trojan-Source)', () => {
    expect(trainingTradeCreateSchema.safeParse(valid({ lessonLearned: 'note‮evil' })).success).toBe(
      false,
    );
  });

  it('rejects a lessonLearned with a zero-width space (U+200B)', () => {
    expect(trainingTradeCreateSchema.safeParse(valid({ lessonLearned: 'hid​den' })).success).toBe(
      false,
    );
  });

  // ----- enteredAt (mirror Trade.enteredAt bounds — instant, not @db.Date) -----

  it('rejects an enteredAt in the future (> now + 1h)', () => {
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect(trainingTradeCreateSchema.safeParse(valid({ enteredAt: future })).success).toBe(false);
  });

  it('rejects an enteredAt before 2000-01-01', () => {
    expect(
      trainingTradeCreateSchema.safeParse(valid({ enteredAt: '1999-12-31T00:00:00.000Z' })).success,
    ).toBe(false);
  });

  // ----- required fields -----

  it('rejects a missing pair', () => {
    const { pair: _p, ...rest } = valid();
    expect(trainingTradeCreateSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a missing lessonLearned', () => {
    const { lessonLearned: _l, ...rest } = valid();
    expect(trainingTradeCreateSchema.safeParse(rest).success).toBe(false);
  });
});
