/**
 * TDD-first tests for `public-trade.ts` Zod schemas (T5).
 *
 * Coverage focus :
 *   - Instrument allowlist + bidi/zero-width reject (Trojan Source).
 *   - Cross-field invariants (status ↔ exitedAt/resultR).
 *   - Decimal coercion (string → number).
 *   - Tags array + caps.
 *   - Notes hardening (safeFreeText).
 *   - Partial schema bounds.
 */

import { describe, expect, it } from 'vitest';

import {
  publicTradeCreateSchema,
  publicTradePartialSchema,
  publicTradeUpdateSchema,
  PUBLIC_TRADE_SEGMENTS,
  PUBLIC_TRADE_STATUSES,
} from './public-trade';

// =============================================================================
// Helpers — minimal valid trade for permutations
// =============================================================================

function validOpen() {
  return {
    segment: 'live' as const,
    instrument: 'EURUSD',
    enteredAt: '2026-05-22T10:00:00Z',
    riskPercent: 1.0,
    status: 'open' as const,
  };
}

function validClosed() {
  return {
    segment: 'live' as const,
    instrument: 'XAUUSD',
    enteredAt: '2026-05-22T10:00:00Z',
    exitedAt: '2026-05-22T14:00:00Z',
    riskPercent: 1.5,
    resultR: 2.0,
    status: 'closed' as const,
  };
}

function validBE() {
  return {
    segment: 'live' as const,
    instrument: 'US30',
    enteredAt: '2026-05-22T10:00:00Z',
    exitedAt: '2026-05-22T12:00:00Z',
    riskPercent: 1.0,
    resultR: 0,
    status: 'break_even' as const,
  };
}

// =============================================================================
// publicTradeCreateSchema — happy paths
// =============================================================================

describe('publicTradeCreateSchema — happy paths', () => {
  it('accepts a minimal open trade', () => {
    const r = publicTradeCreateSchema.safeParse(validOpen());
    expect(r.success).toBe(true);
  });

  it('accepts a fully-resolved closed trade', () => {
    const r = publicTradeCreateSchema.safeParse(validClosed());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.resultR).toBe(2.0);
      expect(r.data.tags).toEqual([]); // default
    }
  });

  it('accepts BE trade with resultR=0', () => {
    const r = publicTradeCreateSchema.safeParse(validBE());
    expect(r.success).toBe(true);
  });

  it('accepts BE trade with resultR=null', () => {
    const r = publicTradeCreateSchema.safeParse({ ...validBE(), resultR: null });
    expect(r.success).toBe(true);
  });

  it('uppercases instrument input', () => {
    const r = publicTradeCreateSchema.safeParse({ ...validOpen(), instrument: 'eurusd' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.instrument).toBe('EURUSD');
  });
});

// =============================================================================
// Cross-field invariants
// =============================================================================

describe('publicTradeCreateSchema — cross-field invariants', () => {
  it('rejects closed without exitedAt', () => {
    const { exitedAt: _e, ...rest } = validClosed();
    void _e;
    const r = publicTradeCreateSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('exitedAt');
    }
  });

  it('rejects closed without resultR', () => {
    const { resultR: _r, ...rest } = validClosed();
    void _r;
    const r = publicTradeCreateSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('resultR');
    }
  });

  it('rejects break_even with nonzero resultR', () => {
    const r = publicTradeCreateSchema.safeParse({ ...validBE(), resultR: 0.5 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('resultR');
    }
  });

  it('rejects exitedAt before enteredAt', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validClosed(),
      enteredAt: '2026-05-22T14:00:00Z',
      exitedAt: '2026-05-22T10:00:00Z',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('exitedAt');
    }
  });
});

// =============================================================================
// Hardening — Trojan Source / bidi / zero-width / instrument allowlist
// =============================================================================

describe('publicTradeCreateSchema — hardening', () => {
  it('rejects instrument with bidi control char (U+202E RLO)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      instrument: 'EUR‮USD',
    });
    expect(r.success).toBe(false);
  });

  it('rejects instrument with zero-width space', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      instrument: 'EUR​USD',
    });
    expect(r.success).toBe(false);
  });

  it('rejects instrument with slash or special chars', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      instrument: 'EUR/USD',
    });
    expect(r.success).toBe(false);
  });

  it('rejects instrument too short', () => {
    const r = publicTradeCreateSchema.safeParse({ ...validOpen(), instrument: 'EU' });
    expect(r.success).toBe(false);
  });

  it('rejects instrument too long', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      instrument: 'EURUSDXYZAB',
    });
    expect(r.success).toBe(false);
  });

  it('rejects notes with bidi control char', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      notes: 'analyse ‮ malveillante',
    });
    expect(r.success).toBe(false);
  });

  it('accepts FR diacritics in notes', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      notes: 'Trade gagnant après cassure de résistance — éxécution propre.',
    });
    expect(r.success).toBe(true);
  });
});

// =============================================================================
// Bounds — risk / R / ordinal / tags
// =============================================================================

describe('publicTradeCreateSchema — bounds', () => {
  it('rejects riskPercent = 0', () => {
    const r = publicTradeCreateSchema.safeParse({ ...validOpen(), riskPercent: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects riskPercent > 99.99 (Tharp ceiling)', () => {
    const r = publicTradeCreateSchema.safeParse({ ...validOpen(), riskPercent: 100 });
    expect(r.success).toBe(false);
  });

  it('rejects resultR > 100', () => {
    const r = publicTradeCreateSchema.safeParse({ ...validClosed(), resultR: 101 });
    expect(r.success).toBe(false);
  });

  it('rejects resultR < -100', () => {
    const r = publicTradeCreateSchema.safeParse({ ...validClosed(), resultR: -101 });
    expect(r.success).toBe(false);
  });

  it('rejects ordinal = 0', () => {
    const r = publicTradeCreateSchema.safeParse({ ...validOpen(), ordinal: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects ordinal > 99999', () => {
    const r = publicTradeCreateSchema.safeParse({ ...validOpen(), ordinal: 100000 });
    expect(r.success).toBe(false);
  });

  it('rejects > 10 tags', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
    });
    expect(r.success).toBe(false);
  });

  it('rejects tag > 50 chars', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      tags: ['x'.repeat(51)],
    });
    expect(r.success).toBe(false);
  });
});

// =============================================================================
// Coercion — string → number for form inputs
// =============================================================================

describe('publicTradeCreateSchema — coercion', () => {
  it('coerces riskPercent string to number', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      riskPercent: '1.5' as unknown as number,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.riskPercent).toBe(1.5);
  });

  it('coerces resultR string to number (closed)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validClosed(),
      resultR: '2.5' as unknown as number,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.resultR).toBe(2.5);
  });

  it('coerces enteredAt ISO string to Date', () => {
    const r = publicTradeCreateSchema.safeParse(validOpen());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.enteredAt).toBeInstanceOf(Date);
  });
});

// =============================================================================
// Strict mode — reject unknown fields
// =============================================================================

describe('publicTradeCreateSchema — strict mode', () => {
  it('rejects unknown field (anti-tamper)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      resultPercent: 50, // computed server-side, NOT form input
    });
    expect(r.success).toBe(false);
  });

  it('rejects source field (server-derived)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      source: 'manual_tamper',
    });
    expect(r.success).toBe(false);
  });
});

// =============================================================================
// publicTradeUpdateSchema — partial input
// =============================================================================

describe('publicTradeUpdateSchema', () => {
  it('accepts empty object (no-op update)', () => {
    const r = publicTradeUpdateSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('accepts single field update', () => {
    const r = publicTradeUpdateSchema.safeParse({ status: 'closed' });
    expect(r.success).toBe(true);
  });

  it('does NOT re-validate cross-field (service post-merge enforces it)', () => {
    // status=closed sans exitedAt/resultR doit PASS au Zod level —
    // c'est `validateLifecycleInvariants` côté service qui catch.
    const r = publicTradeUpdateSchema.safeParse({ status: 'closed' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown fields', () => {
    const r = publicTradeUpdateSchema.safeParse({ resultPercent: 50 });
    expect(r.success).toBe(false);
  });
});

// =============================================================================
// publicTradePartialSchema
// =============================================================================

describe('publicTradePartialSchema', () => {
  it('accepts a valid TP1 leg', () => {
    const r = publicTradePartialSchema.safeParse({
      closedAtR: 1.5,
      closedPercent: 50,
      closedAt: '2026-05-22T12:00:00Z',
    });
    expect(r.success).toBe(true);
  });

  it('rejects closedPercent = 0', () => {
    const r = publicTradePartialSchema.safeParse({
      closedAtR: 1.5,
      closedPercent: 0,
      closedAt: '2026-05-22T12:00:00Z',
    });
    expect(r.success).toBe(false);
  });

  it('rejects closedPercent > 100', () => {
    const r = publicTradePartialSchema.safeParse({
      closedAtR: 1.5,
      closedPercent: 100.5,
      closedAt: '2026-05-22T12:00:00Z',
    });
    expect(r.success).toBe(false);
  });

  it('rejects notes with bidi', () => {
    const r = publicTradePartialSchema.safeParse({
      closedAtR: 1.5,
      closedPercent: 50,
      closedAt: '2026-05-22T12:00:00Z',
      notes: '‮ hidden',
    });
    expect(r.success).toBe(false);
  });

  it('coerces decimal strings', () => {
    const r = publicTradePartialSchema.safeParse({
      closedAtR: '1.5' as unknown as number,
      closedPercent: '50' as unknown as number,
      closedAt: '2026-05-22T12:00:00Z',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.closedAtR).toBe(1.5);
      expect(r.data.closedPercent).toBe(50);
    }
  });
});

// =============================================================================
// Enum invariants — schema constants match Prisma
// =============================================================================

describe('schema constants', () => {
  it('PUBLIC_TRADE_SEGMENTS matches Prisma enum literal', () => {
    expect([...PUBLIC_TRADE_SEGMENTS].sort()).toEqual(['historical', 'live']);
  });

  it('PUBLIC_TRADE_STATUSES matches Prisma enum literal', () => {
    expect([...PUBLIC_TRADE_STATUSES].sort()).toEqual(['break_even', 'closed', 'open']);
  });
});

// =============================================================================
// screenshotUrl allowlist — T5 audit Phase H, security-auditor H1 SSRF defense
// =============================================================================
//
// `screenshotUrl` est rendu sur `trackrecordfxmily.pages.dev` (vitrine
// publique static export Cloudflare Pages) après un rebuild. Sans allowlist
// scheme, un admin (ou XSS chain V2 si admin role escalation future) pouvait
// stocker une URL exotique qui s'exécutait au render :
//   - `javascript:` / `data:` schemes → XSS direct
//   - `file://` → vol filesystem côté process Pages worker
//   - `http://localhost` / `http://169.254.169.254/` (AWS metadata) → SSRF
//     network scan interne ou exfiltration credentials cloud
//   - `//evil.com` protocol-relative → bypass http→https policy
//
// Le refine accepte uniquement HTTPS avec domaine valide OU storage-key
// (`public-trades/<file>.{png|jpg|jpeg|webp}`).

describe('publicTradeCreateSchema — screenshotUrl allowlist (SSRF defense)', () => {
  it('accepts empty string (champ optional)', () => {
    const r = publicTradeCreateSchema.safeParse({ ...validOpen(), screenshotUrl: '' });
    expect(r.success).toBe(true);
  });

  it('accepts a valid HTTPS URL with path', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://cdn.example.com/screenshots/abc123.png',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a storage-key (public-trades/...png)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'public-trades/eurusd-20260522.png',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a storage-key with subdir (public-trades/2025/img.webp)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'public-trades/2025/01-january/eurusd-tp2.webp',
    });
    expect(r.success).toBe(true);
  });

  it('rejects javascript: scheme (XSS)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'javascript:alert(1)',
    });
    expect(r.success).toBe(false);
  });

  it('rejects data: scheme', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'data:text/html,<script>alert(1)</script>',
    });
    expect(r.success).toBe(false);
  });

  it('rejects file:// scheme (local filesystem)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'file:///etc/passwd',
    });
    expect(r.success).toBe(false);
  });

  it('rejects http:// (non-TLS — SSRF localhost / AWS metadata)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    });
    expect(r.success).toBe(false);
  });

  it('rejects https://localhost (no dot — SSRF internal)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://localhost:5432/admin',
    });
    expect(r.success).toBe(false);
  });

  it('rejects protocol-relative //evil.com', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: '//evil.com/exfil',
    });
    expect(r.success).toBe(false);
  });

  it('rejects storage-key with disallowed extension (.exe)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'public-trades/payload.exe',
    });
    expect(r.success).toBe(false);
  });

  it('rejects storage-key with absolute path traversal', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: '/public-trades/abc.png',
    });
    expect(r.success).toBe(false);
  });

  // T5 audit Phase H+1 — code-reviewer H-1 : CDN URLs avec query string
  // (`?v=2026-05-22` cache-busting) ou fragment sont COURANTES en prod
  // (Cloudinary signées, GitHub user-content, etc.). Le regex Phase H initial
  // les rejetait — Eliot aurait heurté ça sur la première URL externe.

  it('accepts HTTPS URL with query string (CDN cache-busting)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://cdn.example.com/trades/abc.png?v=2026-05-22',
    });
    expect(r.success).toBe(true);
  });

  it('accepts HTTPS URL with multi-param query string (Cloudinary signed)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://res.cloudinary.com/demo/image/upload/v1/abc.png?token=xyz&sig=abc',
    });
    expect(r.success).toBe(true);
  });

  it('accepts HTTPS URL with fragment', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://cdn.example.com/trades/abc.png#section-zoom',
    });
    expect(r.success).toBe(true);
  });

  // T5 audit Phase H+1 — code-reviewer H-3 : defense-in-depth contre path
  // traversal `..` dans le storage-key. Pas exploitable runtime sur static
  // export Cloudflare (rebuild ne sert que ce qui est listé), mais évite
  // qu'un futur file-server qui résoudrait le path crée un trou silencieux.

  it('rejects storage-key with `..` path traversal (defense-in-depth)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'public-trades/../../etc/passwd.png',
    });
    expect(r.success).toBe(false);
  });

  it('rejects HTTPS URL with `..` in path (defense-in-depth)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://cdn.example.com/../etc/secret.png',
    });
    expect(r.success).toBe(false);
  });
});
