import {
  CalendarCheck2,
  Compass,
  LineChart as LineChartIcon,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import type { Member5AxisRecap } from '@/lib/member-recap/service';
import { cn } from '@/lib/utils';

/**
 * S10(b) — « Ton bilan » : la carte RÉCAP MEMBRE 5 AXES, en tête de
 * `/progression`. Donne la VUE D'ENSEMBLE « où j'en suis sur tous mes axes »
 * que les surfaces détaillées (scores, méthode, réunions, vérification) ne
 * donnaient nulle part isolément.
 *
 * PRÉSENTATIONNEL PUR : props = {@link Member5AxisRecap} (déjà projeté §2-safe par
 * le seam serveur), AUCUN data-fetch. Posture §2 / anti-Black-Hat §31.2 : chaque
 * ligne est un fait de PROCESS, jamais un P&L ni un conseil de marché. JAMAIS de
 * rouge — un score bas se lit calmement (« à renforcer » en ambre). Un axe `null`
 * (non mesuré) est CACHÉ proprement, jamais affiché en faux « 0 ». La présence
 * respecte l'union discriminée : `insufficient_data` → « en attente » rattrapable,
 * jamais un faux « 0 % » quand aucune réunion n'est programmée.
 */

interface AxisRowProps {
  readonly icon: LucideIcon;
  readonly label: string;
  /** Valeur formatée prête à afficher (« 72 / 100 », « 80 % », « en attente »). */
  readonly value: string;
  /** Verdict calme d'un mot (« solide », « à renforcer »…), ou `null`. */
  readonly word: string | null;
  /** Couleur du chiffre (jamais rouge — `--ok` / `--acc-hi` / `--warn` / `--t-3`). */
  readonly fg: string;
  /** Sous-ligne factuelle (détail honnête, count-only). */
  readonly hint: string;
}

/**
 * Map a 0–100 rate to a CALM band — green / lime / amber, never red (§31.2).
 * `null` (not measured) reads neutral grey with no verdict word.
 */
function bandFor(rate: number | null): { fg: string; word: string | null } {
  if (rate === null) return { fg: 'text-[var(--t-3)]', word: null };
  if (rate >= 80) return { fg: 'text-[var(--ok)]', word: 'solide' };
  if (rate >= 50) return { fg: 'text-[var(--acc-hi)]', word: 'en bonne voie' };
  // Calm amber — a nudge, not a red verdict.
  return { fg: 'text-[var(--warn)]', word: 'à renforcer' };
}

function AxisRow({ icon: Icon, label, value, word, fg, hint }: AxisRowProps) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="rounded-control mt-0.5 grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]"
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-semibold text-[var(--t-1)]">{label}</span>
          <span className={cn('f-mono text-[13px] font-semibold tabular-nums', fg)}>
            {value}
            {word ? (
              <span className="ml-1.5 text-[11px] font-medium text-[var(--t-4)]">{word}</span>
            ) : null}
          </span>
        </div>
        <span className="t-foot text-[var(--t-3)]">{hint}</span>
      </div>
    </li>
  );
}

/** Format a 0–1 rate as an integer percent string ("80 %"). */
function formatPercent01(rate: number): string {
  return `${Math.round(rate * 100)} %`;
}

/** Format a signed delta as "+5" / "−3" / "stable" — never punitive. */
function formatDelta(delta: number | null): string {
  if (delta === null || delta === 0) return 'stable';
  if (delta > 0) return `+${delta}`;
  return `−${Math.abs(delta)}`;
}

export function MemberRecapCard({
  recap,
  className = '',
}: {
  recap: Member5AxisRecap;
  className?: string;
}) {
  const rows: AxisRowProps[] = [];

  // ---- Axe 1 — discipline -------------------------------------------------
  if (recap.discipline) {
    const band = bandFor(recap.discipline.score);
    rows.push({
      icon: ShieldCheck,
      label: 'Discipline',
      value: `${recap.discipline.score} / 100`,
      word: band.word,
      fg: band.fg,
      hint: 'Ton score comportemental du moment, un process, jamais un résultat.',
    });
  }

  // ---- Axe 2 — progression ------------------------------------------------
  if (recap.progression) {
    const { disciplineDelta, weeklyTrades, weeklyCheckinDays } = recap.progression;
    const rising = disciplineDelta !== null && disciplineDelta > 0;
    const parts: string[] = [];
    if (weeklyTrades !== null)
      parts.push(`${weeklyTrades} trade${weeklyTrades > 1 ? 's' : ''} cette semaine`);
    if (weeklyCheckinDays !== null)
      parts.push(`${weeklyCheckinDays} jour${weeklyCheckinDays > 1 ? 's' : ''} de check-in`);
    rows.push({
      icon: LineChartIcon,
      label: 'Progression',
      value: formatDelta(disciplineDelta),
      word: null,
      // Green only when rising (positive reinforcement); neutral grey otherwise —
      // never red, even on a decline.
      fg: rising ? 'text-[var(--ok)]' : 'text-[var(--t-3)]',
      hint:
        parts.length > 0
          ? parts.join(' · ')
          : 'Ta trajectoire apparaît dès quelques jours de recul.',
    });
  }

  // ---- Axe 3 — présence ---------------------------------------------------
  if (recap.presence) {
    if (recap.presence.kind === 'ok') {
      const band = bandFor(Math.round(recap.presence.rate * 100));
      rows.push({
        icon: CalendarCheck2,
        label: 'Présence aux réunions',
        value: formatPercent01(recap.presence.rate),
        word: band.word,
        fg: band.fg,
        hint: `${recap.presence.completedCount} sur ${recap.presence.scheduledCount} réunion${
          recap.presence.scheduledCount > 1 ? 's' : ''
        } suivie${recap.presence.completedCount > 1 ? 's' : ''}, direct ou replay.`,
      });
    } else {
      // insufficient_data → calm "en attente", NEVER a fake 0 %.
      rows.push({
        icon: CalendarCheck2,
        label: 'Présence aux réunions',
        value: 'en attente',
        word: null,
        fg: 'text-[var(--t-3)]',
        hint: 'Aucune réunion sur ta fenêtre pour l’instant, rien à rattraper.',
      });
    }
  }

  // ---- Axe 4 — travail-sur-soi / méthode ----------------------------------
  if (recap.selfWork) {
    const { methodRate, coachingHeadline } = recap.selfWork;
    const band = bandFor(methodRate);
    rows.push({
      icon: Compass,
      label: 'Travail sur toi & méthode',
      value: methodRate === null ? '—' : `${methodRate} %`,
      word: band.word,
      fg: band.fg,
      hint:
        coachingHeadline ??
        'Ta fidélité aux règles dures de la méthode, un miroir, pas un verdict.',
    });
  }

  // ---- Axe 5 — constance & honnêteté --------------------------------------
  if (recap.constance) {
    const { score, proofsCount, accountsCount } = recap.constance;
    const band = bandFor(score);
    const proofPart =
      proofsCount > 0
        ? `${proofsCount} preuve${proofsCount > 1 ? 's' : ''} déposée${proofsCount > 1 ? 's' : ''}`
        : 'aucune preuve déposée pour l’instant';
    rows.push({
      icon: Sparkles,
      label: 'Constance & honnêteté',
      value: score === null ? '—' : `${score} / 100`,
      word: band.word,
      fg: band.fg,
      hint:
        accountsCount > 0
          ? `${proofPart} · ${accountsCount} compte${accountsCount > 1 ? 's' : ''} suivi${accountsCount > 1 ? 's' : ''}.`
          : `${proofPart}.`,
    });
  }

  // Nothing measured yet across all five axes → a single pedagogical empty state
  // (honest, calm — never a card full of fake zeros).
  const isEmpty = rows.length === 0;

  return (
    <section
      data-slot="member-recap-card"
      aria-labelledby="member-recap-heading"
      className={cn(
        'rounded-card-lg flex flex-col gap-4 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-5',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="t-eyebrow text-[var(--acc-hi)]">Ton bilan</span>
          <h2 id="member-recap-heading" className="text-[15px] font-semibold text-[var(--t-1)]">
            Où tu en es, sur tous tes axes
          </h2>
        </div>
        <span
          aria-hidden="true"
          className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--bg-1)] text-[var(--acc-hi)]"
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </div>

      {isEmpty ? (
        <p className="t-body leading-[1.5] text-[var(--t-2)]">
          Dès tes premiers check-ins, trades et réunions, ton bilan d’ensemble apparaîtra ici,
          calmement, axe par axe : ta discipline, ta progression, ta présence, ton travail sur la
          méthode et ta constance. Une photo pour te situer, jamais une sanction.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-3.5">
            {rows.map((row) => (
              <AxisRow key={row.label} {...row} />
            ))}
          </ul>
          <p className="t-foot border-t border-[var(--b-acc)] pt-3 text-[var(--t-3)]">
            Une vue d’ensemble, pas une note. Chaque axe est un repère de process, la régularité
            compte plus qu’un chiffre isolé.
          </p>
        </>
      )}
    </section>
  );
}
