/**
 * Sentry Edge runtime init (Vercel Edge / middleware).
 *
 * Currently Fxmily only ships an Edge-tagged middleware (`proxy.ts`) but no
 * Edge-runtime routes — every API route is `runtime = 'nodejs'` because we
 * need Prisma + argon2. Still, the wizard expects this file and a fresh
 * Edge-runtime route would inherit the same scrubbing.
 *
 * V1.11 — `beforeSend` symmetric scrub with server + client. The Auth.js
 * v5 wrapper `proxy.ts` runs in Edge runtime on EVERY request (matcher
 * exclude `api`, `_next/static`, but matches `/onboarding/welcome?token=...`
 * + `/login?email=...`). If it throws, Sentry Edge would otherwise send
 * cookies (session JWT) + query_string non-scrubbed = session hijack
 * possible. Round 4 sub-agent N finding.
 */
import * as Sentry from '@sentry/nextjs';

import {
  stripSensitiveQueryParams,
  stripSensitiveUrlParams,
} from './src/lib/observability/url-scrub';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    enableLogs: false,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (typeof event.request.query_string === 'string') {
          event.request.query_string = stripSensitiveQueryParams(event.request.query_string);
        }
        if (typeof event.request.url === 'string') {
          event.request.url = stripSensitiveUrlParams(event.request.url);
        }
        if (event.request.headers) {
          for (const k of Object.keys(event.request.headers)) {
            if (/^(cookie|authorization|x-cron-secret)$/i.test(k)) {
              event.request.headers[k] = '[Filtered]';
            }
          }
        }
      }
      if (event.user) {
        delete event.user.ip_address;
        delete event.user.email;
      }
      return event;
    },
  });
}
