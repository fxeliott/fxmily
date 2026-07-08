import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarRange,
  Check,
  ClipboardList,
  Coffee,
  HeartHandshake,
  MessageSquare,
  Moon,
  RotateCcw,
  Sun,
  Sunrise,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import { categoryMetaFor, slotLabelFor, slotOrderIndex } from '@/components/calendar/calendar-meta';
import { Card } from '@/components/ui/card';
import { HoverLift } from '@/components/ui/hover-lift';
import { Pill } from '@/components/ui/pill';
import {
  type DailyGuidance,
  type GuidanceAction,
  type GuidanceKind,
} from '@/lib/daily-guidance/service';
import { DAY_SLOT_LABELS, type DaySlot } from '@/lib/daily-guidance/slot';
import type { CalendarBlock } from '@/lib/schemas/adaptive-calendar';
import { cn } from '@/lib/utils';

/**
 * Session 5 — "Ton aujourd'hui" : the calm, time-aware daily-guidance panel
 * (DoD §30 #3 — "le guidage quotidien affiche les bonnes actions AU BON
 * MOMENT"). It is the single "now" hub at the top of `/dashboard`.
 *
 * Pure Server Component (no client island) — one `getDailyGuidance` read,
 * everything derived server-side. S6 §32-2 turns it into the consolidated "plan
 * du jour". Surfaces, in one glance: the check-in due for the current slot,
 * TODAY's adaptive-calendar blocks, a meeting today, the weekly mindset QCM
 * (emphasised Monday), and any due tracking relevé — with the current + next
 * action highlighted (`Maintenant` / `Ensuite`). The weekly questionnaire + the
 * Mark Douglas inbox keep their dedicated richer widgets below
 * (CalendarStatusWidget / DouglasInboxWidget) — the panel deliberately does NOT
 * duplicate them, it owns the time-of-day-sensitive actions + due relevés.
 *
 * Posture §2 + anti-Black-Hat (§31.2, BLOQUANT): organises TIME, never the
 * market. NO streak, NO score, NO red "pas fait", NO countdown — `done` is a
 * quiet ack (muted + check), `todo` a calm accent row, `missed` a calm amber
 * "rattrapable" catch-up (never red), `info` neutral. The slot label is the
 * only "moment" cue. Mobile-first (375 → 2-up blocks on sm).
 */

const SLOT_ICON: Record<DaySlot, LucideIcon> = {
  morning: Sunrise,
  afternoon: Sun,
  evening: Moon,
};

const KIND_ICON: Record<GuidanceKind, LucideIcon> = {
  checkin: Sun,
  meeting: Users,
  mindset: Brain,
  questionnaire: CalendarRange,
  douglas: BookOpen,
  tracking: ClipboardList,
  'correction-echo': MessageSquare,
  'crisis-followup': HeartHandshake,
  // Tour 14 — off day: a calm "pause" glyph (a mug), never a check-in sun/moon.
  off: Coffee,
};

function ActionRow({ action }: { action: GuidanceAction }) {
  const isPrimary = action.emphasis === 'primary';
  const isDone = action.state === 'done';
  // S6 §32-2 — `missed` = a calm, amber "rattrapable" catch-up (NEVER red/
  // punitive — anti-Black-Hat §31.2). It outranks `primary` visually so the one
  // thing that slipped reads first; its glyph is the "go-back" RotateCcw.
  const isMissed = action.state === 'missed';
  // Check-in derives its glyph from the slot (morning → Sun, evening → Moon) to
  // match `CheckinSlotChip`'s convention; everything else maps by kind. Inline
  // lookup (not a helper returning a component) to satisfy the
  // no-component-created-during-render lint.
  const Icon = isMissed
    ? RotateCcw
    : action.kind === 'checkin'
      ? action.key.endsWith('evening')
        ? Moon
        : Sun
      : KIND_ICON[action.kind];
  // The "primary + not done" row sits on the blue `acc-dim` ground and the
  // `missed` row on the amber `warn-dim` ground; both captions need `--t-2` to
  // clear WCAG 1.4.3 4.5:1 (a11y audit) — `--t-3` dips below on those tints.
  const detailTone = isMissed || (isPrimary && !isDone) ? 'text-[var(--t-2)]' : 'text-[var(--t-3)]';

  return (
    <HoverLift className="block">
      <Link
        href={action.href}
        data-slot="guidance-action"
        data-kind={action.kind}
        data-state={action.state}
        className={cn(
          'rounded-control flex items-center gap-3 border p-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
          isDone
            ? 'border-[var(--b-default)] bg-[var(--bg-1)]'
            : isMissed
              ? 'border-[var(--warn-edge)] bg-[var(--warn-dim)] hover:border-[var(--warn)]'
              : isPrimary
                ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] hover:bg-[var(--acc-dim-2)]'
                : 'border-[var(--b-default)] bg-[var(--bg-2)] hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)]',
        )}
      >
        <div
          className={cn(
            'rounded-control grid h-9 w-9 shrink-0 place-items-center border',
            isDone
              ? 'border-[var(--b-default)] text-[var(--t-3)]'
              : isMissed
                ? 'border-[var(--warn-edge)] bg-[var(--warn-dim)] text-[var(--warn)]'
                : isPrimary
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]'
                  : 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]',
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'truncate text-[13px] font-semibold',
                isDone ? 'text-[var(--t-3)]' : 'text-[var(--t-1)]',
              )}
            >
              {action.title}
            </span>
            {/* §32-2 — "action en cours" / "action suivante" wayfinding. Calm
                marker, never a countdown/urgency (§2). On a `missed` (amber)
                row the pill takes the `warn` tone: the default `mute`/`acc`
                pill text dips below WCAG 1.4.3 4.5:1 on the `--warn-dim` ground
                (a11y audit), whereas `warn` text is the vetted high-contrast
                pairing — and it stays amber-calm, never red (§31.2). */}
            {action.timing === 'current' ? (
              <Pill tone={isMissed ? 'warn' : 'acc'} className="shrink-0">
                Maintenant
              </Pill>
            ) : action.timing === 'next' ? (
              <Pill tone={isMissed ? 'warn' : 'mute'} className="shrink-0">
                Ensuite
              </Pill>
            ) : null}
          </div>
          <span className={cn('t-cap leading-snug', detailTone)}>{action.detail}</span>
        </div>
        {isDone ? (
          <Check className="h-4 w-4 shrink-0 text-[var(--ok)]" strokeWidth={2} aria-label="fait" />
        ) : (
          <ArrowRight
            className="h-4 w-4 shrink-0 text-[var(--t-4)]"
            strokeWidth={1.75}
            aria-label={isMissed ? 'à rattraper' : 'à faire'}
          />
        )}
      </Link>
    </HoverLift>
  );
}

function TodayBlocksList({
  blocks,
  currentSlot,
}: {
  blocks: CalendarBlock[];
  currentSlot: DaySlot;
}) {
  const sorted = [...blocks].sort((a, b) => slotOrderIndex(a.slot) - slotOrderIndex(b.slot));
  return (
    <section aria-label="Ton plan du jour" className="flex flex-col gap-2">
      {/* EU AI Act 50(1) — `block.label` is free AI prose (schema
          `adaptive-calendar.ts` `label: safeText`, Claude-generated), so it MUST
          carry the disclosure, identical to the twin `/calendrier` surface
          (calendrier/page.tsx:137) and `monthly-debrief-reader`/admin panels. The
          deterministic `meta.label` (category) is NOT AI — only this list is
          covered. Same `variant="inline"` + `/legal/ai-disclosure` link as the
          other 5 surfaces (DS + posture §2: calm cyan note, never alarm). */}
      <AIGeneratedBanner variant="inline" />
      {/* Tour 14 — dégraissage : sous-titre de la liste du plan en h3 sentence-case
          (hiérarchie) au lieu du kicker uppercase générique. */}
      <span className="t-h3 text-[var(--t-2)]">Ton plan du jour</span>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {sorted.map((block, idx) => {
          const meta = categoryMetaFor(block.category);
          // §32-1 — "chaque créneau émet un rappel AU BON MOMENT" : the block(s)
          // whose slot is the member's current moment get a calm `Maintenant`
          // marker (same wayfinding token as the action rows). In-app cue only,
          // no countdown/push (§31.2, Chantier B deliberately not built).
          const isNow = block.slot === currentSlot;
          return (
            <li
              key={`${block.slot}-${idx}`}
              data-now={isNow ? 'true' : undefined}
              className={cn(
                'rounded-control flex items-stretch gap-2.5 border bg-[var(--bg-1)] p-2.5',
                isNow ? 'border-[var(--b-acc)]' : 'border-[var(--b-default)]',
                block.priority === 'low' && 'opacity-70',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'shrink-0 self-stretch rounded-full',
                  block.priority === 'high' ? 'w-1.5' : 'w-1',
                )}
                style={{ backgroundColor: meta.color }}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="t-cap flex items-center gap-1.5 text-[var(--t-3)]">
                  <span className="truncate">
                    {meta.label} · {slotLabelFor(block.slot)} · {block.durationMin} min
                  </span>
                  {isNow ? (
                    <Pill tone="acc" className="shrink-0">
                      Maintenant
                    </Pill>
                  ) : null}
                </span>
                <span className="text-[13px] leading-snug text-[var(--t-1)]">
                  {block.label}
                  {block.priority === 'high' ? (
                    <span className="sr-only"> (temps fort)</span>
                  ) : block.priority === 'low' ? (
                    <span className="sr-only"> (secondaire)</span>
                  ) : null}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Calm one-line framing of the calendar state, shown above the actions. */
function CalendarStateLine({ state }: { state: 'generated' | 'preparing' | 'none' }) {
  const text =
    state === 'preparing'
      ? 'Ton calendrier de la semaine se prépare, il sera prêt demain matin au plus tard.'
      : state === 'none'
        ? 'Ta semaine n’est pas encore organisée : le questionnaire plus bas prépare ton calendrier.'
        : 'Journée libre dans ton calendrier, aucun bloc planifié aujourd’hui.';
  return (
    <p className="t-cap rounded-control border border-[var(--b-default)] bg-[var(--bg-1)] p-3 text-[var(--t-3)]">
      {text}
    </p>
  );
}

/**
 * V2 refonte J1 — now a pure presentational Server Component. The page fetches
 * `getDailyGuidance` ONCE and shares the result with the north-star hero (which
 * elevates the single primary action), so this panel renders the full picture
 * without a second DB round-trip (no N+1) and no Suspense boundary.
 *
 * S19.2 — `excludeKey`: the north-star hero already elevates the single primary
 * action as the page's focal CTA. Passing that action's key here drops it from
 * the list so the same "next action" is not rendered twice ~200px apart (the
 * "one focal point" principle). `hasTodo` stays computed on the FULL list so the
 * "tu es à jour" ack only shows when truly nothing is pending (incl. the hero's
 * action). Omit the prop and the panel renders every action (unchanged).
 */
export function TodayGuidance({
  guidance,
  excludeKey,
}: {
  guidance: DailyGuidance;
  excludeKey?: string | undefined;
}) {
  const SlotIcon = SLOT_ICON[guidance.slot];
  // A `missed` catch-up counts as pending, so the "tu es à jour" ack only shows
  // when nothing is left to do OR rattraper (S6 §32-2).
  const hasTodo = guidance.actions.some((a) => a.state === 'todo' || a.state === 'missed');
  const listActions = excludeKey
    ? guidance.actions.filter((a) => a.key !== excludeKey)
    : guidance.actions;
  const hasTodayBlocks = guidance.calendarState === 'generated' && guidance.todayBlocks.length > 0;

  return (
    <Card primary glass className="@container flex flex-col gap-4 p-5" data-slot="today-guidance">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="rounded-control grid h-7 w-7 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]"
            aria-hidden="true"
          >
            <SlotIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <h2 id="today-guidance-heading" className="t-eyebrow-lg text-[var(--t-1)]">
            Ton aujourd&apos;hui
          </h2>
          <Pill tone="acc">{DAY_SLOT_LABELS[guidance.slot]}</Pill>
        </div>
        <span className="t-cap text-[var(--t-3)] tabular-nums">{guidance.todayLabel}</span>
      </header>

      {/* TODAY's calendar blocks — the heart of "guidage du jour". When the week
          is generated with blocks today, show them; otherwise a single calm
          framing line (preparing / none / free day). */}
      {hasTodayBlocks ? (
        <TodayBlocksList blocks={guidance.todayBlocks} currentSlot={guidance.slot} />
      ) : (
        <CalendarStateLine state={guidance.calendarState} />
      )}

      {/* Time-aware actions (ordered most-"now" first). The hero-elevated primary
          action is dropped here when `excludeKey` is passed (no double-render). */}
      {listActions.length > 0 ? (
        <section aria-label="Tes actions du jour" className="flex flex-col gap-2">
          <span className="t-eyebrow text-[var(--t-3)]">À ton rythme</span>
          {listActions.map((action) => (
            <ActionRow key={action.key} action={action} />
          ))}
        </section>
      ) : null}

      {!hasTodo ? (
        <p className="t-cap flex items-center gap-1.5 text-[var(--t-3)]">
          <Check className="h-3.5 w-3.5 text-[var(--ok)]" strokeWidth={2} aria-hidden="true" />
          Tu es à jour pour ce moment de la journée. La discipline, un pas à la fois.
        </p>
      ) : null}

      <Link
        href="/calendrier"
        className="inline-flex min-h-[24px] w-fit items-center gap-1 py-1 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        Voir tout mon calendrier
        <ArrowRight className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </Card>
  );
}
