import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { db } from '@/lib/db';

/**
 * Health check endpoint (SPEC §12.4).
 *
 * - Liveness  : l'API tourne (toujours 200 si on arrive ici).
 * - Readiness : env validation OK + connexion DB répond à `SELECT 1`.
 *
 * Au Jalon 0 : seulement env + DB.
 * À enrichir aux jalons suivants : R2 reachable (J1+), Resend reachable (J1),
 * Anthropic API reachable (J8). Cf. SPEC §12.4.
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

export async function GET(): Promise<NextResponse<HealthBody>> {
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
