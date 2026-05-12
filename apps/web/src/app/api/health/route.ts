import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { callerId, healthLimiter } from '@/lib/rate-limit/token-bucket';

/**
 * Health check endpoint (SPEC §12.4).
 *
 * - Liveness  : l'API tourne (toujours 200 si on arrive ici).
 * - Readiness : env validation OK + connexion DB répond à `SELECT 1`.
 *
 * Au Jalon 0 : seulement env + DB.
 * À enrichir aux jalons suivants : R2 reachable (J1+), Resend reachable (J1),
 * Anthropic API reachable (J8). Cf. SPEC §12.4.
 *
 * V1.6 extras — per-IP rate-limit via `healthLimiter` (burst 30, refill 1/s).
 * Defense against pool saturation attack identified by Round 5 security-auditor
 * audit : without rate-limit, ~11 concurrent unauth requests could saturate
 * the Prisma pool (V1.6 max=10) and stall every other route for 5s+ via
 * `connectionTimeoutMillis`.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DB_PING_TIMEOUT_MS = 2000;

type CheckResult = 'ok' | 'unavailable';

type HealthBody = {
  status: 'ok' | 'degraded';
  service: 'fxmily-web';
  environment: 'development' | 'production' | 'test';
  timestamp: string;
  checks: {
    env: CheckResult;
    db: CheckResult;
  };
  error?: string;
};

type RateLimitedBody = {
  error: 'rate_limited';
  retryAfterMs: number;
};

async function pingDatabase(): Promise<CheckResult> {
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DB ping timeout')), DB_PING_TIMEOUT_MS),
      ),
    ]);
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

export async function GET(req: Request): Promise<NextResponse<HealthBody | RateLimitedBody>> {
  // V1.6 extras — per-IP rate-limit. Caddy forwards `x-forwarded-for` so
  // `callerId()` picks up the real client IP. Burst 30 covers kubelet probes
  // and uptime monitors ; refill 1/s sustained throttles a pool-saturation
  // attack while keeping legitimate ops traffic snappy.
  const id = callerId(req);
  const decision = healthLimiter.consume(id);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' as const, retryAfterMs: decision.retryAfterMs },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)),
          'Cache-Control': 'no-store, max-age=0',
        },
      },
    );
  }

  const dbStatus = await pingDatabase();
  const allOk = dbStatus === 'ok';

  const body: HealthBody = {
    status: allOk ? 'ok' : 'degraded',
    service: 'fxmily-web',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    checks: {
      env: 'ok',
      db: dbStatus,
    },
  };

  return NextResponse.json(body, {
    status: allOk ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
