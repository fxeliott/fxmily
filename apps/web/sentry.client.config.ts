/**
 * Sentry client-side init (browser bundle).
 *
 * Runs at module-eval in the browser. Initialised only when
 * `NEXT_PUBLIC_SENTRY_DSN` is set so dev environments without a DSN don't
 * generate noisy "no DSN provided" warnings.
 *
 * Wired by `next.config.ts` → `withSentryConfig` (the Sentry plugin imports
 * this file automatically into the client manifest).
 */
import * as Sentry from '@sentry/nextjs';

import {
  stripSensitiveQueryParams,
  stripSensitiveUrlParams,
} from './src/lib/observability/url-scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // V1 cohort: 30 → 1000 members. Keep tracing modest until volume justifies.
    tracesSampleRate: 0.1,
    // Session replay disabled — privacy posture (SPEC §16, no analytics, no
    // session recording). Enabling later requires explicit consent UI.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enableLogs: false,
    // Strip query strings from breadcrumbs — Fxmily query params can carry
    // tradeId / reportId references which are PII-adjacent.
    beforeBreadcrumb(breadcrumb) {
      if (
        breadcrumb.category === 'navigation' &&
        breadcrumb.data &&
        typeof breadcrumb.data['to'] === 'string'
      ) {
        try {
          const u = new URL(breadcrumb.data['to'], 'https://placeholder.invalid');
          breadcrumb.data['to'] = u.pathname;
        } catch {
          /* malformed URL — leave as-is */
        }
      }
      return breadcrumb;
    },
    // Last-line PII scrubber. Mutate-in-place + return the event so we
    // don't re-declare Sentry's whole `ErrorEvent` shape (which has 50+
    // optional fields).
    //
    // V1.11 — symmetric URL/query_string scrub with server config. A JS
    // error on `/onboarding/welcome?token=...` (J1) or future
    // `/api/auth/callback/email?token=...` (J1.5 magic-link) would
    // otherwise carry the token plaintext to Sentry SaaS — 60s window
    // for a Sentry org member to consume the invitation. Round 4
    // sub-agent N finding.
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
