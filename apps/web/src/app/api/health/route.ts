import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

/**
 * Health check endpoint.
 * - Liveness : l'API tourne (200 immédiat).
 * - Readiness : valide que les variables critiques sont bien typées
 *   (importer `env` déclenche la validation Zod si pas déjà faite par
 *   l'instrumentation hook).
 *
 * Au Jalon 0 : pas de DB ping. Le SPEC §12.4 prévoit DB+R2+Resend en J10.
 * On enrichit l'endpoint à chaque jalon où une nouvelle dépendance externe
 * est câblée.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type HealthStatus = {
  status: 'ok';
  service: 'fxmily-web';
  environment: 'development' | 'production' | 'test';
  timestamp: string;
  checks: {
    env: 'ok';
  };
};

export async function GET(): Promise<NextResponse<HealthStatus>> {
  const body: HealthStatus = {
    status: 'ok',
    service: 'fxmily-web',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    checks: {
      env: 'ok',
    },
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
