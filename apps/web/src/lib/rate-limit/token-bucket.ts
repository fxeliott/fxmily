import 'server-only';

/**
 * Server-only facade over `./token-bucket-core`.
 *
 * P2 quick-win (2026-07-11): `src/proxy.ts` now consumes
 * `sentryTunnelLimiter` + `callerIdTrusted`, but the middleware bundle must
 * not evaluate the `server-only` package — under its `default` export
 * condition it throws at import time, and whether Next resolves the
 * `react-server` (no-op) condition for the proxy layer is bundler-dependent.
 * The implementation therefore lives in `./token-bucket-core` (marker-free)
 * and this module re-exports it behind the `server-only` guard so that:
 *
 * - every existing app-layer import keeps its protection AND its module path
 *   (`@/lib/rate-limit/token-bucket`), which consumer tests `vi.mock(...)`
 *   by path;
 * - only `src/proxy.ts` imports from `./token-bucket-core` directly.
 *
 * App code (route handlers, Server Actions, services): import from HERE.
 */
export * from './token-bucket-core';
