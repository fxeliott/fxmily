/**
 * Next.js instrumentation hook — exécuté UNE fois au démarrage du runtime.
 * Cf. https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 *
 * On l'utilise pour valider l'environnement au boot (fail fast)
 * plutôt que d'attendre la première requête qui touche la DB.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Importe (et donc exécute) la validation Zod de lib/env.
    await import('@/lib/env');
  }
}
