import { describe, expect, it } from 'vitest';

import { envSchemaWithRefines } from './env';

/**
 * J9 hardening E2 — cross-var consistency tests on VAPID env vars.
 *
 * The runtime `parsed = envSchemaWithRefines.safeParse(process.env)` lives
 * at module-import-time so we can't assert against it directly. Instead we
 * test the schema in isolation with synthetic env objects.
 */

const BASE_VALID_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  AUTH_SECRET: 'test_secret_at_least_32_characters_long_for_dev_xy',
  AUTH_URL: 'http://localhost:3000',
} as const;

// 87-char base64url VAPID public key (canonical P-256 ECDSA).
const VALID_VAPID_PUB = 'BNc' + 'A'.repeat(84);
// 43-char base64url VAPID private key (canonical 32-byte scalar).
const VALID_VAPID_PRIV = 'tA9' + 'B'.repeat(40);

describe('envSchemaWithRefines — VAPID cross-var refines (J9 E2)', () => {
  it('accepts the env when all VAPID vars are absent (V1 default)', () => {
    const r = envSchemaWithRefines.safeParse(BASE_VALID_ENV);
    expect(r.success).toBe(true);
  });

  it('accepts the env when all 3 VAPID vars are present + matching pubkey mirror', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
      VAPID_SUBJECT: 'mailto:eliot@fxmilyapp.com',
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
    });
    expect(r.success).toBe(true);
  });

  it('rejects when only VAPID_PUBLIC_KEY is set (private missing)', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('VAPID_PRIVATE_KEY');
    }
  });

  it('rejects when only VAPID_PRIVATE_KEY is set (public missing)', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
    });
    expect(r.success).toBe(false);
  });

  it('rejects when VAPID_PUBLIC_KEY is set but NEXT_PUBLIC mirror is missing', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
      VAPID_SUBJECT: 'mailto:test@example.com',
      // NEXT_PUBLIC_VAPID_PUBLIC_KEY missing
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('NEXT_PUBLIC_VAPID_PUBLIC_KEY');
    }
  });

  it('rejects when NEXT_PUBLIC mirror has a different value than the server pubkey (drift)', () => {
    const otherPub = 'BNc' + 'C'.repeat(84);
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
      VAPID_SUBJECT: 'mailto:test@example.com',
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: otherPub,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('mirror');
    }
  });

  it('accepts VAPID_SUBJECT with mailto: prefix', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
      VAPID_SUBJECT: 'mailto:foo@bar.com',
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
    });
    expect(r.success).toBe(true);
  });

  it('accepts VAPID_SUBJECT with https:// prefix', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
      VAPID_PRIVATE_KEY: VALID_VAPID_PRIV,
      VAPID_SUBJECT: 'https://app.fxmilyapp.com',
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: VALID_VAPID_PUB,
    });
    expect(r.success).toBe(true);
  });

  it('rejects VAPID_SUBJECT with bare email (no scheme)', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      VAPID_SUBJECT: 'eliott@fxmilyapp.com',
    });
    expect(r.success).toBe(false);
  });
});

/**
 * Jalon 5 hardening — `CRON_SECRET` requis en production.
 *
 * Sans secret en prod, tous les `/api/cron/*` répondent 503 `cron_disabled`
 * en silence (rappels/dispatch/recompute/purge RGPD morts). Le refine top-level
 * détecte la prod via `NODE_ENV === 'production'` OU `AUTH_URL` en HTTPS — le
 * même signal que le reste du fichier (cf. le refine `AUTH_URL`). On exerce les
 * deux signaux de prod, et on garde dev/test non bloqués.
 */
const VALID_CRON_SECRET = 'a'.repeat(24); // 24 chars exactement (borne min)

/** The 6 batch AI tokens a valid PROD env now also requires (Tour 15). A prod
 *  "happy path" must set them all, else the batch-token refines below reject. */
const PROD_BATCH_TOKENS = {
  ADMIN_BATCH_TOKEN: 'b'.repeat(32),
  MONTHLY_ADMIN_BATCH_TOKEN: 'b'.repeat(32),
  CALENDAR_ADMIN_BATCH_TOKEN: 'b'.repeat(32),
  VERIFICATION_ADMIN_BATCH_TOKEN: 'b'.repeat(32),
  SEANCES_ADMIN_BATCH_TOKEN: 'b'.repeat(32),
  PROFILE_ADMIN_BATCH_TOKEN: 'b'.repeat(32),
} as const;

describe('envSchemaWithRefines — CRON_SECRET prod requirement (J5 hardening)', () => {
  it('rejects prod (NODE_ENV=production) without CRON_SECRET', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      NODE_ENV: 'production',
      AUTH_URL: 'https://app.fxmilyapp.com',
      // CRON_SECRET absent → boot bloqué
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('CRON_SECRET');
    }
  });

  it('rejects prod (AUTH_URL en HTTPS, NODE_ENV non-prod) without CRON_SECRET', () => {
    // Le signal HTTPS seul doit suffire à exiger le secret, même si NODE_ENV
    // n'est pas 'production' (build runtime où NODE_ENV peut diverger).
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      AUTH_URL: 'https://app.fxmilyapp.com',
      // CRON_SECRET absent → boot bloqué
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('CRON_SECRET');
    }
  });

  it('accepts prod with CRON_SECRET ≥ 24 chars (+ the required batch tokens)', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      NODE_ENV: 'production',
      AUTH_URL: 'https://app.fxmilyapp.com',
      CRON_SECRET: VALID_CRON_SECRET,
      // Tour 15 : a valid prod env now also requires the 6 batch AI tokens.
      ...PROD_BATCH_TOKENS,
    });
    expect(r.success).toBe(true);
  });

  it('rejects prod with CRON_SECRET too short (< 24 chars) — field-level min(24)', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      NODE_ENV: 'production',
      AUTH_URL: 'https://app.fxmilyapp.com',
      CRON_SECRET: 'a'.repeat(23),
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('CRON_SECRET');
    }
  });

  it('accepts dev (http localhost) without CRON_SECRET — reste optional hors prod', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      // NODE_ENV=development + AUTH_URL=http://localhost:3000 (BASE_VALID_ENV)
      // → pas de signal prod → CRON_SECRET non requis
    });
    expect(r.success).toBe(true);
  });
});

/**
 * Tour 15 hardening — les 6 tokens des pipelines batch IA requis en production.
 *
 * Sans un `*_ADMIN_BATCH_TOKEN` en prod, la route `/api/admin/<pipeline>-batch/*`
 * répond 503 `<pipeline>_batch_disabled` en silence : le worker local ne peut plus
 * pull et le pipeline IA devient muet (incident « IA muette »). Chaque refine
 * miroir bloque le boot exactement comme `CRON_SECRET`, avec une issue de path
 * ciblée sur le token manquant. On exerce les deux signaux de prod et on garde
 * dev/test non bloqués. Un `openssl rand -hex 32` (64 chars) satisfait le
 * `.min(32)` de chaque champ.
 */
/** Les 6 tokens batch IA + un secret cron valide, pour isoler le refine d'un
 *  seul token en le retirant d'un jeu complet par ailleurs. */
const ALL_BATCH_TOKENS = {
  CRON_SECRET: VALID_CRON_SECRET,
  ...PROD_BATCH_TOKENS,
} as const;

const PROD_SIGNAL_ENV = {
  ...BASE_VALID_ENV,
  NODE_ENV: 'production',
  AUTH_URL: 'https://app.fxmilyapp.com',
} as const;

const BATCH_TOKEN_NAMES = [
  'ADMIN_BATCH_TOKEN',
  'MONTHLY_ADMIN_BATCH_TOKEN',
  'CALENDAR_ADMIN_BATCH_TOKEN',
  'VERIFICATION_ADMIN_BATCH_TOKEN',
  'SEANCES_ADMIN_BATCH_TOKEN',
  'PROFILE_ADMIN_BATCH_TOKEN',
] as const;

describe('envSchemaWithRefines — batch AI tokens prod requirement (Tour 15 hardening)', () => {
  it('accepts prod with all 6 batch tokens set', () => {
    const r = envSchemaWithRefines.safeParse({ ...PROD_SIGNAL_ENV, ...ALL_BATCH_TOKENS });
    expect(r.success).toBe(true);
  });

  it.each(BATCH_TOKEN_NAMES)('rejects prod (NODE_ENV=production) when %s is missing', (missing) => {
    const tokens: Record<string, string> = { ...ALL_BATCH_TOKENS };
    delete tokens[missing];
    const r = envSchemaWithRefines.safeParse({ ...PROD_SIGNAL_ENV, ...tokens });
    expect(r.success).toBe(false);
    if (!r.success) {
      // The issue path must name the EXACT missing token so the boot error is
      // actionable (which token to provision), not a generic "config invalid".
      const paths = r.error.issues.flatMap((i) => i.path);
      expect(paths).toContain(missing);
    }
  });

  it.each(BATCH_TOKEN_NAMES)(
    'rejects prod (AUTH_URL HTTPS, NODE_ENV non-prod) when %s is missing',
    (missing) => {
      const tokens: Record<string, string> = { ...ALL_BATCH_TOKENS };
      delete tokens[missing];
      // HTTPS signal alone must require the token, even when NODE_ENV is not prod.
      const r = envSchemaWithRefines.safeParse({
        ...BASE_VALID_ENV,
        AUTH_URL: 'https://app.fxmilyapp.com',
        ...tokens,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.flatMap((i) => i.path)).toContain(missing);
      }
    },
  );

  it('accepts dev (http localhost) without any batch token — reste optional hors prod', () => {
    const r = envSchemaWithRefines.safeParse({ ...BASE_VALID_ENV });
    expect(r.success).toBe(true);
  });
});

/**
 * J1 hardening — R2 offsite mirror vars deployed all-or-none.
 *
 * Une config R2 partielle (1 à 3 vars sur 4) passe silencieusement en mode
 * "local-only" (`isR2Configured()` === false) : le mirror offsite est
 * désactivé sans erreur visible. Le refine bloque le boot pour forcer une
 * config complète ou totalement absente. Truthiness volontaire : une chaîne
 * vide compte comme absente (parité `isR2Configured()`).
 */
const FULL_R2_ENV = {
  R2_ACCOUNT_ID: 'acc',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'bucket',
} as const;

describe('envSchemaWithRefines — R2 mirror all-or-none (J1 hardening)', () => {
  it('accepts the env when all 4 R2 vars are absent (local-only mode)', () => {
    const r = envSchemaWithRefines.safeParse(BASE_VALID_ENV);
    expect(r.success).toBe(true);
  });

  it('accepts the env when all 4 R2 vars are set', () => {
    const r = envSchemaWithRefines.safeParse({ ...BASE_VALID_ENV, ...FULL_R2_ENV });
    expect(r.success).toBe(true);
  });

  it('rejects when only R2_ACCOUNT_ID is set (1/4)', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      R2_ACCOUNT_ID: 'acc',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('deployed together');
      expect(r.error.issues.flatMap((i) => i.path)).toContain('R2_ACCOUNT_ID');
    }
  });

  it('rejects when 3 of 4 R2 vars are set (missing R2_BUCKET)', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      // R2_BUCKET missing → partial config must block the boot
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('deployed together');
    }
  });

  it('treats empty strings as absent (all 4 empty → local-only, accepted)', () => {
    const r = envSchemaWithRefines.safeParse({
      ...BASE_VALID_ENV,
      R2_ACCOUNT_ID: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
      R2_BUCKET: '',
    });
    expect(r.success).toBe(true);
  });
});
