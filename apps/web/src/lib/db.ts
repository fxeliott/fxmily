import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env } from '@/lib/env';

/**
 * Singleton Prisma Client (Prisma 7+ Rust-free, driver adapter pg).
 * Évite la création de connexions multiples en dev (hot reload Next.js).
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  // V1.6 — Prisma 7 + adapter-pg defaults changed silently vs v6 :
  //   v6 : connectionTimeoutMillis = 5_000 (pool full → throws after 5s)
  //   v7 : connectionTimeoutMillis = 0     (pool full → hangs forever)
  // Without explicit config, every cron + Server Action that touches DB can
  // deadlock indefinitely on a saturated pool. Pin to v6 defaults explicitly
  // (cf. Prisma skills /prisma-upgrade-v7/references/driver-adapters.md).
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // TCP keepalive (2026-06-29 A-Z deep audit) — let the OS detect a peer that
    // vanished (NAT idle-reap, server crash, failover) instead of trusting a
    // half-open socket that looks fine until the next write hangs. Probes start
    // 10 s after the socket goes quiet. Pure safety ; no effect on the healthy
    // sub-second OLTP traffic this app runs.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    // Scale hardening (2026-06-29 A-Z audit) — a single runaway query (missing
    // index hit, accidental cross join) must not pin a pool slot indefinitely
    // and cascade into pool exhaustion for every other request. statement_timeout
    // aborts it server-side; idle_in_transaction_session_timeout reaps a
    // transaction left open holding row locks. Generous defaults (30 s / 60 s)
    // never touch the sub-second OLTP queries this app runs, and both are
    // env-tunable / 0=off.
    ...(env.DATABASE_STATEMENT_TIMEOUT_MS > 0
      ? { statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS }
      : {}),
    ...(env.DATABASE_IDLE_IN_TX_TIMEOUT_MS > 0
      ? { idle_in_transaction_session_timeout: env.DATABASE_IDLE_IN_TX_TIMEOUT_MS }
      : {}),
    // CLIENT-side query timeout — the dead-socket complement to the server-side
    // statement_timeout above : it fires even when the backend has silently gone
    // away and will never deliver a cancel, so a black-holed query can't pin its
    // pool connection for minutes. Defaulted just above statement_timeout so the
    // server wins on a live socket; this only reaps a dead one (env.ts).
    ...(env.DATABASE_QUERY_TIMEOUT_MS > 0 ? { query_timeout: env.DATABASE_QUERY_TIMEOUT_MS } : {}),
    // Force connection rotation so a stale connection to a demoted primary
    // (silent failover / rolling restart) gets recycled instead of erroring on
    // next checkout. Disabled at 0.
    ...(env.DATABASE_MAX_LIFETIME_S > 0 ? { maxLifetimeSeconds: env.DATABASE_MAX_LIFETIME_S } : {}),
  });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
