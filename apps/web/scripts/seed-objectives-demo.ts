/**
 * Backfill ~40 jours de `BehavioralScore` pour le compte demo (jalon J4
 * « Où je vais »). Le seed J6 crée trades + check-ins mais PAS les snapshots de
 * score (le service de scoring est `server-only`, intsable depuis tsx). Ce
 * script insère directement des lignes (db n'est pas server-only) avec une
 * tendance discipline douce et montante (~56 → ~79) pour que la page /objectifs
 * affiche de vrais anneaux + une trajectoire projetée vers la cible Maîtrise 85.
 *
 * Usage (après seed-j6-demo) :
 *   $env:DATABASE_URL = "postgresql://fxmily:fxmily_dev@localhost:5432/fxmily?schema=public"
 *   pnpm --filter @fxmily/web exec tsx scripts/seed-objectives-demo.ts
 *
 * Demo-only : ne touche QUE le compte `j6demo.admin.e2e.test@fxmily.local`.
 */

import { db } from '../src/lib/db.js';

const EMAIL = 'j6demo.admin.e2e.test@fxmily.local';
const DAYS = 40;

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** Date-only (UTC minuit) à `days` jours avant aujourd'hui. */
function dateMinus(days: number): Date {
  const d = new Date(Date.now() - days * 86_400_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function main() {
  const user = await db.user.findUnique({ where: { email: EMAIL } });
  if (!user) throw new Error(`demo user ${EMAIL} introuvable — lance seed-j6-demo d'abord`);

  let n = 0;
  for (let d = DAYS - 1; d >= 0; d--) {
    const p = (DAYS - 1 - d) / (DAYS - 1); // 0 (vieux) → 1 (aujourd'hui)
    const discipline = clamp(56 + p * 23 + Math.sin(d * 1.7) * 2);
    const emotionalStability = clamp(60 + p * 12 + Math.sin(d * 0.9) * 3);
    const consistency = clamp(64 + p * 10 + Math.cos(d * 1.1) * 2);
    const engagement = clamp(68 + p * 9 + Math.sin(d * 1.3) * 2);
    const date = dateMinus(d);
    await db.behavioralScore.upsert({
      where: { userId_date: { userId: user.id, date } },
      create: {
        userId: user.id,
        date,
        disciplineScore: discipline,
        emotionalStabilityScore: emotionalStability,
        consistencyScore: consistency,
        engagementScore: engagement,
        components: {},
        sampleSize: {},
        windowDays: 30,
      },
      update: {
        disciplineScore: discipline,
        emotionalStabilityScore: emotionalStability,
        consistencyScore: consistency,
        engagementScore: engagement,
      },
    });
    n++;
  }
  console.log(`[seed-objectives] upserted ${n} BehavioralScore rows for ${EMAIL}`);
}

main()
  .catch((err) => {
    console.error('[seed-objectives] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
