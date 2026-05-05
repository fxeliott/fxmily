import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id parameters tuned for an interactive login flow on a small VPS
 * (Hetzner CX22, ~4€/mois, SPEC §10).
 *
 * - `memoryCost` 19 MiB — OWASP 2024 floor for argon2id, comfortable on 4 GiB RAM.
 * - `timeCost` 2 — keeps a single hash under ~150 ms on a typical x86 server.
 * - `parallelism` 1 — single-process workers, no thread pool tuning needed.
 *
 * If we ever migrate to a beefier host, bump `memoryCost` first (it's the
 * strongest dial against GPU/ASIC attackers).
 *
 * `algorithm: 2` is `Algorithm.Argon2id` — we use the numeric literal because
 * `Algorithm` from `@node-rs/argon2` is a `const enum`, which `tsc` rejects
 * under `isolatedModules`.
 */
const PARAMS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMS);
}

/**
 * Verifies a plaintext password against an argon2id hash.
 *
 * Returns false instead of throwing on a malformed hash: a corrupt row in the
 * DB should look like a wrong password to the caller, not crash the auth flow.
 * Throw-worthy errors (memory exhaustion etc.) are still propagated.
 */
export async function verifyPassword(plain: string, storedHash: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch (err) {
    // Argon2 raises on any non-PHC-formatted string. Treat as a mismatch.
    if (err instanceof Error && /invalid|format|encoding/i.test(err.message)) {
      return false;
    }
    throw err;
  }
}
