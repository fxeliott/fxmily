/**
 * Sentry server-side init (Node.js runtime).
 *
 * Loaded at module-eval from `instrumentation.ts → register()` when
 * `NEXT_RUNTIME === 'nodejs'`. Same DSN as the client (single Sentry project)
 * but no replay / no client-only integrations.
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
    // Critical for Fxmily's audit posture : never include the request body
    // in the event payload. The audit log row IS the canonical record;
    // Sentry only carries the stack + breadcrumbs.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        // Body of a request can contain trade screenshots / check-in fields —
        // never let it leave the server-only audit boundary.
        delete event.request.data;
        // J10 Phase G — security-auditor T4.13 : auth flows like
        // `/api/auth/callback/email?token=...` can carry magic-link or
        // verification tokens in the query string. Strip them before any
        // event leaves the process.
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
