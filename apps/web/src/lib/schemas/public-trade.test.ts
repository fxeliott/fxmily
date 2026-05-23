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

  // T5 audit Phase H+2 — H-IPLIT : la JSDoc Phase H promettait de bloquer
  // AWS metadata + LAN IP + IPv6 loopback. Avant ce fix la regex HTTPS de
  // base les acceptait car `[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+` matche aussi
  // les digits. Non-exploitable V1 (vitrine ne render PAS screenshotUrl)
  // mais latent pour T6 wiring. Fix : 2 lookahead regex (IPv4 + IPv6).

  it('rejects IPv4 literal `https://169.254.169.254/` (AWS metadata SSRF)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://169.254.169.254/latest/meta-data/iam',
    });
    expect(r.success).toBe(false);
  });

  it('rejects IPv4 literal `https://192.168.1.1/` (LAN SSRF)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://192.168.1.1/admin.png',
    });
    expect(r.success).toBe(false);
  });

  it('rejects IPv4 literal with port `https://10.0.0.1:8080/` (LAN SSRF)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://10.0.0.1:8080/secret.png',
    });
    expect(r.success).toBe(false);
  });

  it('rejects IPv6 literal `https://[::1]/` (loopback SSRF)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://[::1]/admin',
    });
    expect(r.success).toBe(false);
  });

  it('rejects IPv6 literal `https://[fe80::1]/` (link-local SSRF)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://[fe80::1]/x.png',
    });
    expect(r.success).toBe(false);
  });

  it('accepts DNS host that contains digits `https://cdn4.example.com/img.png` (FP defense)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://cdn4.example.com/img.png',
    });
    expect(r.success).toBe(true);
  });

  it('accepts DNS host with subdomain digits `https://s3-eu-west-1.amazonaws.com/path.png`', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      screenshotUrl: 'https://s3-eu-west-1.amazonaws.com/bucket/img.png',
    });
    expect(r.success).toBe(true);
  });
});

// =============================================================================
// Phase H+4 stress-test #1 (TIER 1) — status=open invariants
// =============================================================================
//
// Le stress-test sub-agent Phase H+3 a détecté que le superRefine couvrait
// uniquement `closed` + `break_even` + `exitedAt < enteredAt` MAIS pas
// `status=open + (exitedAt|resultR non-vide)`. Le JSDoc l.243 annonçait
// l'invariant comme "form-level warn" mais aucune branche ne le rejetait —
// admin pouvait persister un trade "open" avec un `exitedAt` et un `resultR`
// non-null (latent bug qui polluerait les agrégats T6 vitrine + retrouve
// un état incohérent à l'edit). Fix par 2 addIssue strict + tests TDD.

describe('publicTradeCreateSchema — status=open invariants (Phase H+4 TIER 1)', () => {
  it('rejects status=open with exitedAt set (must be null)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      status: 'open',
      exitedAt: new Date('2026-05-22T16:00:00Z'),
      resultR: null,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const exitedAtErr = r.error.issues.find((i) => i.path[0] === 'exitedAt');
      expect(exitedAtErr).toBeDefined();
      expect(exitedAtErr?.message).toContain('vide quand status = open');
    }
  });

  it('rejects status=open with resultR set (must be null)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      status: 'open',
      exitedAt: null,
      resultR: 2.5,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const resultRErr = r.error.issues.find((i) => i.path[0] === 'resultR');
      expect(resultRErr).toBeDefined();
      expect(resultRErr?.message).toContain('vide quand status = open');
    }
  });

  it('rejects status=open with BOTH exitedAt and resultR set (collects 2 issues)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      status: 'open',
      exitedAt: new Date('2026-05-22T16:00:00Z'),
      resultR: 2.5,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('exitedAt');
      expect(paths).toContain('resultR');
    }
  });

  it('accepts status=open with both exitedAt and resultR null (golden path)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      status: 'open',
      exitedAt: null,
      resultR: null,
    });
    expect(r.success).toBe(true);
  });

  it('accepts status=open with exitedAt + resultR fields absent entirely', () => {
    // Same as above but using key-absence rather than explicit null. Zod
    // `.nullable().optional()` accepts both. `validOpen()` returns a minimal
    // payload that omits both keys — admin form submit sans ces champs (HTML
    // `<input>` non rempli → FormData entry absent).
    const r = publicTradeCreateSchema.safeParse(validOpen());
    expect(r.success).toBe(true);
  });
});

// =============================================================================
// Phase H+4 stress-test #4 (TIER 2) — FR locale comma support
// =============================================================================
//
// Le stress-test sub-agent Phase H+3 a détecté que `riskPercentSchema` +
// `resultRSchema` n'avaient PAS le fix V1.5.2 FR locale (`z.preprocess` qui
// remplace `,` par `.`). Eliot tape habituellement en locale FR → `Number("1,5")
// === NaN` → côté form-shaper `numFieldNullable` mappait silencieusement à
// `null` (cf. H+1 H-4 distinction NaN→null silent clear) → input admin
// disparaissait sans erreur visible. Carbone V1.5.2 pattern Trade.riskPct.

describe('publicTradeCreateSchema — FR locale comma support (Phase H+4 TIER 2)', () => {
  it('accepts riskPercent FR locale `"1,5"` (comma → dot transform)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      riskPercent: '1,5',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.riskPercent).toBe(1.5);
    }
  });

  it('accepts resultR FR locale `"2,5"` on closed trade', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      status: 'closed',
      exitedAt: new Date('2026-05-22T16:00:00Z'),
      resultR: '2,5',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.resultR).toBe(2.5);
    }
  });

  it('accepts riskPercent dot-notation `"1.5"` (backward-compat)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      riskPercent: '1.5',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.riskPercent).toBe(1.5);
    }
  });

  it('rejects multi-comma `"1,5,7"` (ambiguous → NaN after replace-first)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      riskPercent: '1,5,7',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const err = r.error.issues.find((i) => i.path[0] === 'riskPercent');
      expect(err).toBeDefined();
      // After preprocess "1,5,7" → "1.5,7" → Number("1.5,7") === NaN → Zod 4
      // `z.coerce.number()` rejects at coerce stage with "Invalid input:
      // expected number" (avant que `.finite()` ne soit atteint). On valide
      // l'effet (rejection sur le path correct) sans pinner le wording exact
      // qui peut drift entre versions Zod.
      expect(err?.code).toBeDefined();
    }
  });

  it('accepts riskPercent as native number 1.5 (no preprocess needed)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      riskPercent: 1.5,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.riskPercent).toBe(1.5);
    }
  });
});

// =============================================================================
// Phase H+5 TIER 1 #1 — Europe/Paris timezone interpretation on datetime-local
// =============================================================================
//
// Le sub-agent code-reviewer Phase H+5 a détecté que `z.coerce.date()` sur
// une string datetime-local (`YYYY-MM-DDTHH:MM[:SS]` SANS TZ designator)
// interprète comme **local-time du serveur runtime**. Sur Hetzner UTC,
// `new Date("2026-05-22T12:00")` = `2026-05-22T12:00Z` MAIS l'admin
// (Paris CEST) voulait dire `2026-05-22T10:00Z`. Drift cumulatif silencieux
// à chaque save innocent. Fix : preprocess qui interprète Europe/Paris.

describe('publicTradeCreateSchema — Europe/Paris timezone (Phase H+5 TIER 1)', () => {
  it('interprets datetime-local string (no TZ) as Europe/Paris CEST (summer)', () => {
    // Admin saisit `"2026-05-22T12:00"` (noon Paris CEST UTC+2)
    // Expected UTC instant: `2026-05-22T10:00:00.000Z`
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: '2026-05-22T12:00',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.enteredAt).toBeInstanceOf(Date);
      expect(r.data.enteredAt.toISOString()).toBe('2026-05-22T10:00:00.000Z');
    }
  });

  it('interprets datetime-local string (no TZ) as Europe/Paris CET (winter)', () => {
    // Admin saisit `"2026-01-15T12:00"` (noon Paris CET UTC+1)
    // Expected UTC instant: `2026-01-15T11:00:00.000Z`
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: '2026-01-15T12:00',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.enteredAt.toISOString()).toBe('2026-01-15T11:00:00.000Z');
    }
  });

  it('preserves Z-suffixed UTC string unchanged (pass-through path)', () => {
    // Admin script ou serialization émet ISO avec Z → pass-through cohérent
    // `new Date()`.
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: '2026-05-22T10:00:00.000Z',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.enteredAt.toISOString()).toBe('2026-05-22T10:00:00.000Z');
    }
  });

  it('preserves Date object pass-through (test fixture path)', () => {
    const dateObj = new Date('2026-05-22T10:00:00.000Z');
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: dateObj,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.enteredAt.toISOString()).toBe('2026-05-22T10:00:00.000Z');
    }
  });

  it('handles datetime-local with seconds component', () => {
    // `<input type="datetime-local" step="1">` peut émettre seconds.
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: '2026-05-22T12:00:30',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.enteredAt.toISOString()).toBe('2026-05-22T10:00:30.000Z');
    }
  });

  it('round-trip preserves the UTC instant — no cumulative drift on re-save', () => {
    // Critical regression test : the bug was that admin save WITHOUT TOUCHING
    // the field shifted the UTC instant. Simulate the round-trip :
    //   1. DB stores `2026-05-22T10:00:00.000Z` (UTC instant, was Paris noon).
    //   2. Server-Component renders, pre-fills form with `toDatetimeLocal()`
    //      result = `"2026-05-22T12:00"` (Paris wall-clock, the admin's POV).
    //   3. Admin submits without touching. FormData carries `"2026-05-22T12:00"`.
    //   4. Server Zod re-parses. MUST yield `2026-05-22T10:00:00.000Z` (identical
    //      UTC instant). Avant fix Phase H+5 : `2026-05-22T12:00:00.000Z`
    //      (drift +2h, cumulative regression).
    const original = new Date('2026-05-22T10:00:00.000Z');
    // Simule `toDatetimeLocal` côté client (Paris CEST) — `"2026-05-22T12:00"`.
    // On hardcode la string que le browser side renvoie pour rendre le test
    // déterministe (vs dépendre du TZ du runner CI).
    const formSubmittedString = '2026-05-22T12:00';
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: formSubmittedString,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // L'instant UTC reparsé DOIT être identique à l'original.
      expect(r.data.enteredAt.getTime()).toBe(original.getTime());
    }
  });

  // Phase H+6 DST edge cases — pin l'algorithme déterministe.
  // Le wall-clock `02:30` est ambigu autour des transitions DST européennes :
  //   - Spring forward (last Sun of March) : `02:30` n'existe pas (clocks
  //     jump 02:00 CET → 03:00 CEST). Algorithme produit une interprétation
  //     "best-effort" déterministe (pre-jump CET).
  //   - Fall back (last Sun of October) : `02:30` happens TWICE (02:30 CEST
  //     puis 02:30 CET). Algorithme picks le post-jump CET (later occurrence).
  // Ces tests pinnent l'output exact pour qu'une régression de l'algorithme
  // soit détectée immédiatement.

  it('DST spring-forward gap : Mar 29 2026 02:30 (wall-clock skipped) produces deterministic Date', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: '2026-03-29T02:30',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // Algorithm output: naive UTC `02:30Z` interprété comme CEST (post-jump
      // car la transition CET→CEST a déjà eu lieu à UTC 01:00). Offset = +2h.
      // Result = `00:30Z` = `01:30 CET` (pre-jump, the non-existent 02:30
      // collapse vers la dernière minute valide pre-jump).
      expect(r.data.enteredAt.toISOString()).toBe('2026-03-29T00:30:00.000Z');
    }
  });

  it('DST fall-back overlap : Oct 25 2026 02:30 (wall-clock happens twice) picks CET (post-jump)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: '2026-10-25T02:30',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // Algorithm output: naive UTC `02:30Z` interprété comme CET (post-jump
      // car la transition CEST→CET a déjà eu lieu à UTC 01:00). Offset = +1h.
      // Result = `01:30Z` = `02:30 CET` (la 2e occurrence du wall-clock 02:30).
      expect(r.data.enteredAt.toISOString()).toBe('2026-10-25T01:30:00.000Z');
    }
  });

  it('Year boundary CET winter : Jan 1 2026 00:00 Paris → 2025-12-31 23:00Z', () => {
    // Edge case anniversaire : admin saisit midnight Paris start-of-year en
    // hiver (CET UTC+1). UTC instant = -1h = last day of previous year.
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: '2026-01-01T00:00',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.enteredAt.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    }
  });

  // Phase H+7 — calendar validity refine (stress-test #7 closure).
  // Sans `.refine`, l'admin pouvait taper `2026-13-01T12:00` (mois 13) ET
  // le helper roll-back-avoidance avant, ou `2026-02-30` (Feb 30 doesn't
  // exist) → `Date.UTC` silently rolls vers le mois/année suivant(e),
  // créant un trade décalé silencieusement. Le helper gate calendar
  // validity returns null, le preprocess flow vers `z.coerce.date()` qui
  // produit Invalid Date (NaN), le `.refine` final attrape avec "Date
  // invalide.".

  it('Phase H+7 — rejects invalid month `2026-13-01T12:00` with "Date invalide."', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: '2026-13-01T12:00',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const err = r.error.issues.find((i) => i.path[0] === 'enteredAt');
      expect(err).toBeDefined();
      // Le message attendu : "Date invalide." (custom refine error map).
      // Vs Zod default générique "Invalid input: expected date".
      expect(err?.message).toBe('Date invalide.');
    }
  });

  it('Phase H+7 — rejects invalid day `2026-02-30T12:00` (Feb 30 inexistant) with "Date invalide."', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: '2026-02-30T12:00',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const err = r.error.issues.find((i) => i.path[0] === 'enteredAt');
      expect(err).toBeDefined();
      expect(err?.message).toBe('Date invalide.');
    }
  });

  it('Phase H+7 — rejects Feb 29 on non-leap year `2026-02-29T12:00` (2026 not leap)', () => {
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: '2026-02-29T12:00',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const err = r.error.issues.find((i) => i.path[0] === 'enteredAt');
      expect(err).toBeDefined();
      expect(err?.message).toBe('Date invalide.');
    }
  });

  it('Phase H+7 — accepts Feb 29 on leap year `2024-02-29T12:00` (2024 IS leap)', () => {
    // Sanity check : le calendar validity gate ne reject pas un Feb 29
    // valide. 2024 est bissextile, 2026 ne l'est pas.
    const r = publicTradeCreateSchema.safeParse({
      ...validOpen(),
      enteredAt: '2024-02-29T12:00',
    });
    expect(r.success).toBe(true);
  });
});
