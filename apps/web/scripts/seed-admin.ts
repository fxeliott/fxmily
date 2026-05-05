/**
 * Seed an admin user.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL = "postgresql://fxmily:fxmily_dev@localhost:5432/fxmily?schema=public"
 *   $env:SEED_ADMIN_EMAIL = "you@example.com"
 *   $env:SEED_ADMIN_PASSWORD = "a-strong-password-12chars"
 *   $env:SEED_ADMIN_FIRST_NAME = "Eliot"
 *   $env:SEED_ADMIN_LAST_NAME = "Pena"
 *   pnpm --filter @fxmily/web exec tsx scripts/seed-admin.ts
 *
 * Idempotent: if a user already exists for the email, the script promotes them
 * to `admin` + `active` and updates the password hash. It never deletes data.
 *
 * The script intentionally requires the password via env var rather than
 * reading stdin so it works in CI / non-interactive shells. Make sure the
 * password is not in your shell history (use a `$env:` assignment in
 * PowerShell, not a CLI argument).
 */

import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/lib/auth/password.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return value;
}

async function main() {
  const databaseUrl = required('DATABASE_URL');
  const email = required('SEED_ADMIN_EMAIL').toLowerCase().trim();
  const password = required('SEED_ADMIN_PASSWORD');
  const firstName = process.env.SEED_ADMIN_FIRST_NAME ?? 'Admin';
  const lastName = process.env.SEED_ADMIN_LAST_NAME ?? 'Fxmily';

  if (password.length < 12) {
    console.error('SEED_ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(2);
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter });

  try {
    const passwordHash = await hashPassword(password);

    const user = await db.user.upsert({
      where: { email },
      create: {
        email,
        firstName,
        lastName,
        passwordHash,
        role: 'admin',
        status: 'active',
        emailVerified: new Date(),
        consentRgpdAt: new Date(),
      },
      update: {
        firstName,
        lastName,
        passwordHash,
        role: 'admin',
        status: 'active',
        emailVerified: new Date(),
      },
      select: { id: true, email: true, role: true, status: true, createdAt: true },
    });

    console.log('✓ Admin user ready');
    console.log(`  id:     ${user.id}`);
    console.log(`  email:  ${user.email}`);
    console.log(`  role:   ${user.role}`);
    console.log(`  status: ${user.status}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('seed-admin failed:', err);
  process.exit(1);
});
