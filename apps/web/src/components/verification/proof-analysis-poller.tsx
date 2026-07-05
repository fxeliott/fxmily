'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Tour 14 — « attente informée » sur `/verification`.
 *
 * Tant qu'au moins une preuve reste `ocrStatus=pending` (comptée serveur-side et
 * passée en prop), ce composant rafraîchit doucement la page (`router.refresh()`)
 * pour faire apparaître le verdict SANS que le membre ait à recharger à la main.
 * L'analyse tourne en arrière-plan (worker toutes les ~20 min) : le membre peut
 * quitter la page, mais s'il reste là, le résultat s'affiche tout seul.
 *
 * Garde-fous (économes, jamais agressifs) :
 *   - poll SEULEMENT quand `pendingCount > 0` ; zéro pending => aucun timer armé ;
 *   - suspendu quand l'onglet est caché (`document.visibilityState`), repris au
 *     retour — pas de refresh en boucle sur un onglet en arrière-plan ;
 *   - cap de durée dur (30 min) : au-delà, on arrête, le membre reviendra ou
 *     rechargera (l'analyse peut prendre plus long selon la file du worker) ;
 *   - aucun état, aucune structure JSX conditionnelle : rend `null`, donc pas de
 *     dépendance à `useReducedMotion` ni de risque d'hydration mismatch.
 *
 * `router.refresh()` re-fetch le Server Component courant sans changer d'URL ni
 * perdre l'état client des autres îles : c'est le moyen le plus léger de
 * récupérer le nouvel `ocrStatus` des preuves.
 */

/** Intervalle entre deux rafraîchissements tant qu'il reste du pending. */
const POLL_INTERVAL_MS = 25_000;
/** Durée maximale de poll sur une même visite (le worker peut être en file). */
const MAX_POLL_DURATION_MS = 30 * 60 * 1000;

interface ProofAnalysisPollerProps {
  /** Nombre de preuves `ocrStatus=pending` visibles au dernier rendu serveur. */
  readonly pendingCount: number;
}

export function ProofAnalysisPoller({ pendingCount }: ProofAnalysisPollerProps) {
  const router = useRouter();
  // Ancre du cap de durée : posée au 1er montage avec du pending, jamais remise
  // à zéro par un simple re-render (un ref, pas un state).
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (pendingCount <= 0) {
      // Plus rien à attendre : on relâche l'ancre pour qu'une future preuve
      // reparte sur une fenêtre de 30 min neuve.
      startedAtRef.current = null;
      return;
    }

    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      // Onglet caché : ne pas rafraîchir (batterie + requêtes inutiles). On
      // reprendra au prochain tick une fois l'onglet revenu au premier plan.
      if (document.visibilityState !== 'visible') return;
      const startedAt = startedAtRef.current;
      if (startedAt !== null && Date.now() - startedAt >= MAX_POLL_DURATION_MS) {
        if (intervalId !== null) clearInterval(intervalId);
        return;
      }
      router.refresh();
    };

    intervalId = setInterval(tick, POLL_INTERVAL_MS);

    // Reprise immédiate quand l'onglet redevient visible : évite d'attendre un
    // cycle complet pour voir un verdict tombé pendant que l'onglet dormait.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (intervalId !== null) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pendingCount, router]);

  return null;
}
