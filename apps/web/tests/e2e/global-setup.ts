import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

/**
 * Playwright global setup (runs once before any test).
 *
 * Loads `apps/web/.env` so test helpers that import `lib/env.ts` (which
 * Zod-validates `DATABASE_URL`/`AUTH_SECRET`/`AUTH_URL` at module load)
 * find the same variables the dev server uses.
 *
 * Without this, helpers like `lib/auth/password.ts` blow up at import time
 * with "Configuration invalide" when Playwright spawns its worker — the
 * worker is a vanilla Node process, no Next.js automatic env injection.
 */
async function globalSetup() {
  loadDotenv({ path: path.resolve(import.meta.dirname, '..', '..', '.env') });
}

export default globalSetup;
