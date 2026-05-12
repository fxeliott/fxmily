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
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
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
