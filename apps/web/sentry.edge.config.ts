/**
 * Sentry Edge runtime init (Vercel Edge / middleware).
 *
 * Currently Fxmily only ships an Edge-tagged middleware (`proxy.ts`) but no
 * Edge-runtime routes — every API route is `runtime = 'nodejs'` because we
 * need Prisma + argon2. Still, the wizard expects this file and a fresh
 * Edge-runtime route would inherit the same scrubbing.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    enableLogs: false,
    sendDefaultPii: false,
  });
}
