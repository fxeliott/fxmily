import { Repeat, ShieldCheck } from 'lucide-react';

import type { PostLossReaction } from '@/lib/scoring/post-loss-reaction';
import { cn } from '@/lib/utils';

/**
 * S25 #6 — « Reprendre après un SL » : the member's intraday reaction to a loss,
 * the sharpest tilt/revenge mirror (cf. `lib/scoring/post-loss-reaction.ts`).
 *
 * Server Component présentationnel pur. Posture §2 : timing/discipline, jamais un
 * signal de marché. §31.2 (BLOQUANT) : CALME — quand le membre n'a pas repris le
 * même jour, c'est célébré sobrement (la coupure est tenue) ; quand il a repris,
 * c'est un constat factuel Mark Douglas, jamais rouge, jamais « tu as fauté ».
 */

export function PostLossReactionCard({ reaction }: { reaction: PostLossReaction }) {
  const { losses, reentries, fastReentries, medianDelayMin, windowDays, hasEnough } = reaction;

  // État vide pédagogique tant qu'il n'y a pas assez de pertes clôturées.
  if (!hasEnough) {
    return (
      <div
        data-slot="post-loss-reaction-card"
        data-state="empty"
        className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-1)] p-5"
      >
        <div className="flex items-start gap-3.5">
          <span className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]">
            <Repeat className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-1">
            <span className="t-eyebrow text-[var(--t-3)]">Réaction après une perte</span>
            <h3 className="text-[15px] font-semibold text-[var(--t-1)]">Reprendre après un SL</h3>
            <p className="t-cap leading-relaxed text-[var(--t-3)]">
              Ce miroir s’affiche après quelques pertes clôturées. Il regarde ta réaction à chaud :
              repars-tu le même jour, et en combien de temps, pas ton résultat.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Aucune reprise le même jour = la coupure est respectée → ton positif sobre.
  const clean = reentries === 0;

  return (
    <div
      data-slot="post-loss-reaction-card"
      data-state={clean ? 'clean' : 'reentries'}
      className={cn(
        'rounded-card-lg border p-5',
        clean
          ? 'border-[var(--ok-edge)] bg-[var(--ok-dim)]'
          : 'border-[var(--warn-edge)] bg-[var(--warn-dim)]',
      )}
    >
      <div className="flex items-start gap-3.5">
        <span
          className={cn(
            'rounded-control grid h-9 w-9 shrink-0 place-items-center border',
            clean
              ? 'border-[var(--ok-edge)] text-[var(--ok)]'
              : 'border-[var(--warn-edge)] text-[var(--warn)]',
          )}
        >
          {clean ? (
            <ShieldCheck className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Repeat className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="t-eyebrow text-[var(--t-3)]">Réaction après une perte</span>
          <h3 className="text-[15px] font-semibold text-[var(--t-1)]">Reprendre après un SL</h3>
          {clean ? (
            <p className="t-cap leading-relaxed text-[var(--t-2)]">
              Sur tes <strong className="text-[var(--t-1)]">{losses}</strong> pertes clôturées des{' '}
              {windowDays} derniers jours, tu n’as{' '}
              <strong className="text-[var(--t-1)]">jamais</strong> repris position le même jour. La
              méthode est claire : un SL, et la journée s’arrête, tu la tiens.
            </p>
          ) : (
            <p className="t-cap leading-relaxed text-[var(--t-2)]">
              Sur tes <strong className="text-[var(--t-1)]">{losses}</strong> pertes clôturées des{' '}
              {windowDays} derniers jours, tu as repris le même jour{' '}
              <strong className="text-[var(--t-1)]">{reentries} fois</strong>
              {fastReentries > 0 ? (
                <>
                  {' '}
                  (dont <strong className="text-[var(--t-1)]">{fastReentries}</strong> en moins de
                  30&nbsp;min)
                </>
              ) : null}
              . La méthode dit : un SL, et la journée s’arrête. Le revenge se joue dans ces
              minutes-là.
            </p>
          )}
        </div>
      </div>

      {/* Chiffre médian (constat factuel, jamais un verdict). */}
      {!clean && medianDelayMin !== null ? (
        <dl className="mt-3.5 flex items-baseline gap-2 border-t border-[var(--warn-edge)] pt-3">
          <dt className="t-cap text-[var(--t-3)]">Délai médian avant de reprendre</dt>
          <dd className="f-mono text-[18px] leading-none font-bold text-[var(--t-1)] tabular-nums">
            {medianDelayMin}
            <span className="text-[12px] font-medium text-[var(--t-3)]"> min</span>
          </dd>
        </dl>
      ) : null}
    </div>
  );
}
