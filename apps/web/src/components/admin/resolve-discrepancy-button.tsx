'use client';

import { CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import { resolveDiscrepancyAction } from '@/app/admin/members/[id]/resolve-discrepancy-actions';
import { Btn } from '@/components/ui/btn';

/**
 * Tour 11 (chantier G, FINDING 3) — bouton discret « Marquer comme traité » sur
 * une ligne d'écart open/acknowledged du panel de vérification admin.
 *
 * Un premier clic demande confirmation (anti-clic accidentel : refermer un écart
 * est un changement d'état), le second envoie l'action (open|acknowledged →
 * resolved, gate-locked côté service). `revalidatePath` dans l'action rafraîchit
 * la ligne (elle bascule sur « Résolu » et perd son bouton).
 *
 * a11y : `role="status"` + `aria-live` annonce le résultat (statut en TEXTE,
 * jamais color-only) ; icône décorative. Pattern carbone `NoteDeleteButton`
 * (useTransition + confirmation auto-annulée après 4 s + cleanup au démontage).
 * Posture §31.2 : libellé factuel, aucun rouge (kind secondary).
 */
export function ResolveDiscrepancyButton({
  memberId,
  discrepancyId,
}: {
  memberId: string;
  discrepancyId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [announce, setAnnounce] = useState('');
  const announceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-annule la confirmation après 4 s — cleanup au démontage.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(id);
  }, [confirming]);

  useEffect(() => {
    return () => {
      if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    };
  }, []);

  function announceFor(msg: string) {
    setAnnounce(msg);
    if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    announceTimeoutRef.current = setTimeout(() => setAnnounce(''), 3000);
  }

  function onResolve() {
    if (!confirming) {
      setConfirming(true);
      announceFor('Confirmation requise pour marquer cet écart comme traité. Clique à nouveau.');
      return;
    }
    startTransition(async () => {
      const r = await resolveDiscrepancyAction(memberId, discrepancyId);
      if (!r.ok) {
        setConfirming(false);
        announceFor('Échec, réessaie dans un instant.');
      } else {
        announceFor('Écart marqué comme traité.');
      }
    });
  }

  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      <Btn
        type="button"
        kind="secondary"
        size="s"
        onClick={onResolve}
        loading={pending}
        disabled={pending}
        aria-label={
          confirming
            ? 'Confirmer : marquer cet écart comme traité'
            : 'Marquer cet écart comme traité'
        }
      >
        <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        {confirming ? 'Confirmer ?' : 'Marquer comme traité'}
      </Btn>
    </>
  );
}
