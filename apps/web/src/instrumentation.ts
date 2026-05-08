/**
 * Next.js instrumentation hook — exécuté UNE fois au démarrage du runtime.
 * Cf. https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 *
 * Deux rôles :
 *   1. **Validation env (J0)** — `import @/lib/env` déclenche le parse Zod
 *      au boot, fail-fast plutôt que d'attendre la première requête qui
 *      touche la DB.
 *   2. **Bootstrap Sentry (J10)** — branche le SDK serveur ou edge selon
 *      le runtime. No-op si `SENTRY_DSN` absent (les configs vérifient).
 *
 * `onRequestError` re-emit les exceptions Server Components / route handlers
 * non-attrapées vers Sentry. Sans ça, elles touchent `error.tsx` mais ne
 * remontent jamais dans le dashboard — ce qui défait le monitoring.
 */
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Validation env Zod (fail-fast au boot).
    await import('@/lib/env');
    // Sentry server-side init (no-op si DSN absent).
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
