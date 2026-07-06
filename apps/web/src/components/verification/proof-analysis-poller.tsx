'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Tour 14 → 15 — « attente informée » sur `/verification`.
 *
 * Tant qu'au moins une preuve reste `ocrStatus=pending` (comptée serveur-side et
 * passée en prop), on veut faire apparaître le verdict SANS que le membre ait à
 * recharger. Tour 14 rafraîchissait toute la page toutes les 25 s
 * (`router.refresh()` = re-rend le Server Component entier, ~7 requêtes DB par
 * tick). Tour 15 remplace ça par un poll LÉGER : on interroge
 * `/api/verification/pending-count` (un seul `count` indexé) toutes les 10 s et
 * on ne déclenche le rafraîchissement complet QUE quand ce nombre change, donc
 * une seule fois par verdict, plus à chaque tick.
 *
 * Garde-fous (économes, jamais agressifs) :
 *   - poll SEULEMENT quand `pendingCount > 0` ; zéro pending => aucun timer armé.
 *     Un nouvel upload appelle `router.refresh()` côté uploader, la page se
 *     re-rend avec `pendingCount > 0`, et cet effet relance le poll ;
 *   - suspendu quand l'onglet est caché (`document.visibilityState`), repris au
 *     retour — pas de requête sur un onglet en arrière-plan ;
 *   - `AbortController` par requête + annulation au démontage : aucune réponse
 *     tardive ne déclenche un refresh sur une page quittée ;
 *   - cap de durée dur (30 min) : au-delà, on arrête, le membre reviendra ou
 *     rechargera (l'analyse peut prendre plus long selon la file du worker) ;
 *   - un seul refresh par changement : la baseline serveur est figée au montage,
 *     dès que le compte fetché en diffère on rafraîchit et on stoppe le poll (le
 *     re-rendu remonte le composant avec la nouvelle prop et repart si besoin) ;
 *   - aucun état, aucune structure JSX conditionnelle : rend `null`, donc pas de
 *     dépendance à `useReducedMotion` ni de risque d'hydration mismatch.
 */

/** Intervalle entre deux sondes tant qu'il reste du pending (léger, ~10 s). */
const POLL_INTERVAL_MS = 10_000;
/** Durée maximale de poll sur une même visite (le worker peut être en file). */
const MAX_POLL_DURATION_MS = 30 * 60 * 1000;

interface ProofAnalysisPollerProps {
  /** Nombre de preuves `ocrStatus=pending` au dernier rendu serveur. */
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

    // Baseline figée pour CE cycle de poll : le nombre de pending tel que le
    // serveur l'a rendu. On rafraîchit dès que la sonde en diffère (une analyse
    // a abouti, ou une nouvelle est apparue via un autre onglet).
    const baseline = pendingCount;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let controller: AbortController | null = null;
    let stopped = false;

    const stop = () => {
      stopped = true;
      if (intervalId !== null) clearInterval(intervalId);
      controller?.abort();
    };

    const probe = async () => {
      // Onglet caché : ne pas sonder (batterie + requêtes inutiles). On
      // reprendra au prochain tick une fois l'onglet revenu au premier plan.
      if (document.visibilityState !== 'visible') return;

      const startedAt = startedAtRef.current;
      if (startedAt !== null && Date.now() - startedAt >= MAX_POLL_DURATION_MS) {
        stop();
        return;
      }

      controller = new AbortController();
      try {
        const res = await fetch('/api/verification/pending-count', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) return; // 401/5xx : on retentera au prochain tick.
        const data = (await res.json()) as { pending?: number };
        if (stopped || typeof data.pending !== 'number') return;
        if (data.pending !== baseline) {
          // Le compte a changé : un verdict est tombé (ou une preuve a été
          // ajoutée ailleurs). Un seul refresh — le re-rendu serveur remonte ce
          // composant avec la nouvelle baseline et relance le poll si besoin.
          stop();
          router.refresh();
        }
      } catch {
        // Réseau coupé ou requête annulée (unmount / abort) : on ignore, le
        // prochain tick retentera si le poll est toujours armé.
      }
    };

    intervalId = setInterval(() => void probe(), POLL_INTERVAL_MS);

    // Reprise immédiate quand l'onglet redevient visible : évite d'attendre un
    // cycle complet pour voir un verdict tombé pendant que l'onglet dormait.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void probe();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pendingCount, router]);

  return null;
}
