/**
 * Vitest shim for `server-only`.
 *
 * The `server-only` package throws at import time if pulled from client code.
 * Next.js shims it during the production build. Under Vitest the package isn't
 * resolved at all unless we install it; we don't want to install it just for
 * tests, so we alias the import to this empty module via `vitest.config.ts`.
 *
 * Tests that exercise server-side libs (e.g. lib/auth/audit, lib/email/send)
 * import them transitively, hit the `import 'server-only'` line, and would
 * otherwise crash with "Cannot find package 'server-only'".
 */
export {};
