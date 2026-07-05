import 'server-only';

import { cache } from 'react';

import { getCalendarForUser, getQuestionnaireForUser } from '@/lib/calendar/service';
import { currentParisWeekStart } from '@/lib/calendar/week';
import { getOffDaySet, isOffDay, isWeekendLocalDate } from '@/lib/checkin/off-days';
import { getCheckinStatus } from '@/lib/checkin/service';
import { formatLocalDate, localDateOf, parseLocalDate } from '@/lib/checkin/timezone';
import { listScheduledMeetingsOn } from '@/lib/meeting/service';
import { getMindsetCheck } from '@/lib/mindset/service';
import { getCorrectionThemes } from '@/lib/annotations/correction-themes';
import { getRecentCrisisSignal } from '@/lib/safety/crisis-followup';
import { getDueTrackingInstruments } from '@/lib/tracking/service';
import { getAxisLabel } from '@/lib/tracking/axes';
import type { CalendarBlock } from '@/lib/schemas/adaptive-calendar';

import { currentDaySlot, primaryCheckinSlot, type DaySlot } from './slot';

/**
 * Session 5 — Guidage quotidien : the "Ton aujourd'hui" derivation layer (DoD
 * §30 #3 — "le guidage quotidien affiche les bonnes actions AU BON MOMENT").
 * S6 §32-2 extends it into the consolidated "plan du jour" : the SINGLE place a
 * member finds everything due, with the current + next action highlighted, a
 * calm `missed` catch-up state, and any due tracking relevé folded in.
 *
 * Aggregates, for one member at a given Europe/Paris instant, the calm,
 * time-aware "what to do now" picture: the check-in due for the current slot
 * (the other slot becomes a calm catch-up once its moment has passed), TODAY's
 * adaptive-calendar blocks, a meeting happening today, the weekly mindset QCM
 * (emphasised Monday), and any process-relevé due today (§28 tracking).
 *
 * ARCHITECTURE (§3/§24). This module is a READ-ONLY UI orchestration layer. It
 * lives OUTSIDE the real-edge tree (`lib/{scoring,analytics,trades,habit}`), so
 * importing the §26 calendar + §27.7 mindset + cards surfaces is firewall-clean
 * — the anti-leak glob only forbids the *reverse* (a real-edge module reading
 * those). It reads ONLY existence/status/booleans + time blocks; it touches NO
 * P&L, feeds NO score, and is consumed solely by the dashboard page (never by a
 * real-edge module).
 *
 * POSTURE §2 + anti-Black-Hat (§31.2, BLOQUANT). Everything here organises the
 * member's TIME of practice, never a market call. NO streak, NO adherence
 * score, NO red "pas fait", NO countdown/urgency — the slot only decides which
 * calm action comes first. A "done" item is a quiet acknowledgement, never a
 * reward fanfare.
 */

/**
 * S6 §32-2 — the daily-plan action lifecycle. `missed` is the brief's explicit
 * "manqué" state: an action whose moment has clearly passed unfilled. It is
 * NEVER rendered red/punitive (anti-Black-Hat §31.2) — it is amber "rattrapable"
 * (see `today-guidance.tsx`). `info` (a meeting nudge) is neither to-do nor done.
 */
export type GuidanceState = 'todo' | 'done' | 'info' | 'missed';
export type GuidanceKind =
  | 'checkin'
  | 'meeting'
  | 'mindset'
  | 'questionnaire'
  | 'douglas'
  | 'tracking'
  // J-AI corrections echo — a calm reminder of a recurring point the coach has
  // raised in corrections this month (`info`, never a to-do, never punitive).
  | 'correction-echo'
  // Crisis follow-up — for 48h after a HIGH/MEDIUM crisis detection, a gentle
  // "how are you today" presence (`info`, never a to-do — the member owes the
  // app nothing after a hard moment). See `lib/safety/crisis-followup.ts`.
  | 'crisis-followup'
  // Tour 14 — off day ("jour off"). When TODAY is off (weekend the member keeps
  // off, or an explicit declaration), the two check-in actions are REPLACED by a
  // single calm `info` acknowledgement: no todo, no missed the evening, no
  // pressure — a "pont" (§31.2). Réunions/tracking stay untouched.
  | 'off';

export interface GuidanceAction {
  /** Stable key for the React list + e2e selectors. */
  key: string;
  kind: GuidanceKind;
  title: string;
  /** One calm sentence of context. Never empty (use a space-free default). */
  detail: string;
  href: string;
  state: GuidanceState;
  /** `primary` = relevant to the current moment; `secondary` = still useful. */
  emphasis: 'primary' | 'secondary';
  /**
   * S6 §32-2 — "met en évidence l'action en cours et l'action suivante". An
   * orthogonal axis to `state`: `current` is the first still-pending action,
   * `next` the one after it. `undefined` for everything else (incl. done/info).
   * Explicit `| undefined` for the repo's `exactOptionalPropertyTypes`.
   */
  timing?: 'current' | 'next' | undefined;
}

/** Whether THIS week's calendar can be shown, is being prepared, or is absent. */
export type CalendarTodayState = 'generated' | 'preparing' | 'none';

export interface DailyGuidance {
  /** "Lundi 8 juin 2026" (FR, first letter capitalised). */
  todayLabel: string;
  /** YYYY-MM-DD Europe/Paris civil day. */
  today: string;
  slot: DaySlot;
  /** Monday (YYYY-MM-DD) of the current Europe/Paris week. */
  weekStart: string;
  calendarState: CalendarTodayState;
  /** TODAY's calendar blocks (sorted morning→evening). Empty if none/preparing. */
  todayBlocks: CalendarBlock[];
  /** Ordered nudges (most "now"-relevant first). */
  actions: GuidanceAction[];
  /**
   * Tour 14 — is the member's local TODAY an off day (weekend kept off, or an
   * explicit declaration)? Drives the dashboard: the day-progress ring is hidden
   * (no misleading 0/0), the first-run welcome never pushes "fais ton premier
   * check-in", and the session timeline can render a calm rest state. The
   * check-in block above is already a calm `off` info row when this is true.
   */
  todayIsOff: boolean;
}

const CHECKIN_META: Record<'morning' | 'evening', { title: string; detail: string; href: string }> =
  {
    morning: {
      title: 'Check-in du matin',
      detail: 'Sommeil, routine, préparation. Pose ton intention du jour.',
      href: '/checkin/morning',
    },
    evening: {
      title: 'Check-in du soir',
      detail: 'Discipline, stress, bilan. Referme ta journée en conscience.',
      href: '/checkin/evening',
    },
  };

function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build one member's daily guidance. `timezone` defaults to the V1 cohort TZ;
 * `now` is injectable for deterministic tests (carbone the calendar/checkin
 * services). All reads run in parallel; every one is count/status/time-only.
 *
 * Exported through React `cache()` (carbone getMethodMirror): the dashboard
 * page and its sections may each ask for the guidance during ONE server render
 * — per-request memoisation collapses the duplicate `(userId)` calls into a
 * single fan-out of queries. Defaults resolve INSIDE the memoised function, so
 * argument-less production calls share one cache key; tests injecting `now`
 * bypass the dedup (distinct Date identity), which is the correct behaviour.
 */
export const getDailyGuidance = cache(buildDailyGuidance);

async function buildDailyGuidance(
  userId: string,
  timezone: string = 'Europe/Paris',
  now: Date = new Date(),
): Promise<DailyGuidance> {
  // `today` is anchored on Europe/Paris because every surface it indexes is
  // Paris-keyed: the adaptive calendar (generated for the Paris week), the §30
  // meetings (`date` = Paris civil day), and the mindset/questionnaire week
  // (Monday Paris). The check-in below stays on the member timezone (a check-in
  // row IS the member's local day), as does `slot` (the member's "moment"). In
  // V1 the cohort is 100% Europe/Paris so the two coincide (byte-identical); but
  // pinning `today` to Paris keeps the calendar/meeting/mindset lookups correct
  // even if a non-Paris member ever exists — the `timezone` param then only
  // governs the member-local check-in + slot, never the Paris-keyed reads.
  const today = localDateOf(now, 'Europe/Paris');
  const slot = currentDaySlot(now, timezone);
  const weekStart = currentParisWeekStart(now);
  const isMonday = parseLocalDate(today).getUTCDay() === 1;

  // The check-in row lives on the MEMBER's local day, so the off-day lookup is
  // keyed on the member-local civil date (same frame as `getCheckinStatus`
  // below), not the Paris-pinned `today` used for the calendar/meeting reads. In
  // the V1 100%-Paris cohort the two coincide, but keeping the off-day check on
  // the member timezone stays correct for a future non-Paris member.
  const memberToday = localDateOf(now, timezone);

  const [
    checkin,
    offDayCtx,
    calendar,
    questionnaire,
    mindset,
    meetings,
    dueTracking,
    correctionThemes,
    crisisSignal,
  ] = await Promise.all([
    getCheckinStatus(userId, timezone, now),
    // Tour 14 — resolve TODAY's off-day status (the single member-local day is
    // both bounds). Drives the "jour off" pont below.
    getOffDaySet(userId, memberToday, memberToday),
    getCalendarForUser(userId, weekStart),
    getQuestionnaireForUser(userId, weekStart),
    getMindsetCheck(userId, weekStart),
    listScheduledMeetingsOn(today),
    getDueTrackingInstruments(userId, now),
    // J-AI corrections echo — the recurring coaching points of the last 30 days.
    getCorrectionThemes(userId, 30, now),
    // Crisis follow-up — most recent HIGH/MEDIUM detection inside 48h, or null.
    getRecentCrisisSignal(userId, now),
  ]);

  // Tour 14 — is the member's local today an off day? A weekend they keep off,
  // or an explicit declaration. When true, the check-in block becomes a single
  // calm `info` acknowledgement (no todo, no missed) — the pont (§31.2).
  const todayIsOff = isOffDay(memberToday, offDayCtx);
  const offIsWeekend = isWeekendLocalDate(memberToday) && !offDayCtx.explicitDates.has(memberToday);

  // --- TODAY's calendar blocks + calendar state -----------------------------
  let calendarState: CalendarTodayState;
  let todayBlocks: CalendarBlock[] = [];
  if (calendar) {
    calendarState = 'generated';
    // Defensive against JSONB drift (a future instrument-v2 or a manual DB edit
    // could yield a schedule whose `days`/`blocks` is not the expected shape) —
    // guard before `.find`, mirroring the calendar-meta category/slot fallbacks.
    // Reads never re-validate the JSONB (only writes `.strict()`-parse it).
    const days = Array.isArray(calendar.schedule?.days) ? calendar.schedule.days : [];
    const day = days.find((d) => d.date === today);
    todayBlocks = day && Array.isArray(day.blocks) ? [...day.blocks] : [];
  } else if (questionnaire) {
    calendarState = 'preparing';
  } else {
    calendarState = 'none';
  }

  // --- Ordered actions ------------------------------------------------------
  const actions: GuidanceAction[] = [];

  // (0) Crisis follow-up — FIRST, above everything, for 48h after a HIGH/MEDIUM
  // detection (audit-derived, see `lib/safety/crisis-followup.ts`). `info` on
  // purpose: it must NEVER become a to-do the member "owes" the app, and the
  // timing highlight below keeps pointing at the check-in as the concrete next
  // step. PRIVACY (RGPD §16): the copy never quotes or paraphrases what the
  // member wrote — only a calm presence, with the 3114 restated on `high`.
  if (crisisSignal) {
    actions.push({
      key: 'crisis-followup',
      kind: 'crisis-followup',
      title: 'Comment tu vas aujourd’hui ?',
      detail:
        crisisSignal.level === 'high'
          ? 'Ces derniers jours ont peut-être été lourds. Prends un instant pour te poser. Le 3114 reste disponible 24h/24, gratuit, si tu en as besoin.'
          : 'Ces derniers jours ont peut-être été chargés. Prends un instant pour te poser, sans pression. On avance à ton rythme.',
      href: '/checkin',
      state: 'info',
      emphasis: 'primary',
    });
  }

  // (1) Check-in — the slot-appropriate one is primary. The "done" one is a
  // calm ack; the secondary one is only surfaced when still to do (anti-clutter).
  const primarySlot = primaryCheckinSlot(slot);
  const otherSlot = primarySlot === 'morning' ? 'evening' : 'morning';
  const submitted = {
    morning: checkin.morningSubmitted,
    evening: checkin.eveningSubmitted,
  } as const;

  // Tour 14 — a member who filed a check-in on their off day is still credited
  // (the rempli always wins): if a slot was submitted, keep the calm "done" ack.
  const filedOnOffDay = todayIsOff && (submitted.morning || submitted.evening);

  if (todayIsOff && !filedOnOffDay) {
    // OFF DAY — the two check-in actions are REPLACED by a single calm `info`
    // row. No todo, no missed the evening: a jour off is a choice of process, a
    // "pont", never a gap (§31.2). Réunions/tracking below stay untouched.
    actions.push({
      key: 'off-day',
      kind: 'off',
      title: 'Jour off',
      detail: offIsWeekend
        ? 'Week-end sans trading. Rien à remplir aujourd’hui, ta constance reste intacte.'
        : 'Tu as posé ce jour comme off. Rien à remplir aujourd’hui, ta constance reste intacte.',
      href: '/checkin',
      state: 'info',
      emphasis: 'primary',
    });
  } else {
    actions.push({
      key: `checkin-${primarySlot}`,
      kind: 'checkin',
      title: CHECKIN_META[primarySlot].title,
      detail: submitted[primarySlot]
        ? 'Fait pour ce moment de la journée.'
        : CHECKIN_META[primarySlot].detail,
      href: CHECKIN_META[primarySlot].href,
      state: submitted[primarySlot] ? 'done' : 'todo',
      emphasis: 'primary',
    });
  }

  // (2) Meeting today (platform-wide, §30) — informational nudge, never shame.
  // The copy names ONLY the slots actually scheduled today: a cancelled/absent
  // 12h must never be announced as "analyse à 12h" (code-review TIER2).
  if (meetings.length > 0) {
    const slots = new Set(meetings.map((m) => m.slot));
    const labels: string[] = [];
    if (slots.has('midday')) labels.push('analyse à 12h');
    if (slots.has('evening')) labels.push('bilan à 20h');
    actions.push({
      key: 'meeting-today',
      kind: 'meeting',
      title: 'Réunion Fxmily aujourd’hui',
      detail: `Aujourd’hui (Paris) : ${labels.join(' · ')}.`,
      href: '/reunions',
      state: 'info',
      emphasis: 'primary',
    });
  }

  // (3) Weekly mindset QCM — surfaced only while unanswered, emphasised Monday
  // (the week opens Monday, §27). Calm: no streak, no "en retard".
  if (mindset === null) {
    actions.push({
      key: 'mindset-week',
      kind: 'mindset',
      title: 'QCM mindset de la semaine',
      detail: 'Une courte auto-évaluation de ton mental de trader (anti-FOMO).',
      href: '/mindset/new',
      state: 'todo',
      emphasis: isMonday ? 'primary' : 'secondary',
    });
  }

  // (4) Secondary check-in (the other slot) — only if still to do. In the
  // evening the MORNING check-in becomes a calm "missed" catch-up (its moment
  // has passed — see slot.ts), surfaced amber-benevolent, NEVER red/punitive
  // (anti-Black-Hat §31.2). The evening check-in is never "missed" while the
  // member is still inside the evening slot (the day isn't over for them).
  //
  // Tour 14 — on an off day WITHOUT any filed slot, the check-in block was
  // replaced by the calm `off` row above, so the secondary slot is skipped too:
  // no `missed` the evening on a day the member owed nothing. When the member
  // DID file a slot on their off day (`filedOnOffDay`), we fall through to the
  // normal path so the other slot is still offered as a plain `todo` (never
  // `missed`, since the day is a bonus, not an obligation).
  const skipSecondaryForOff = todayIsOff && !filedOnOffDay;
  if (!skipSecondaryForOff && !submitted[otherSlot]) {
    // On an off day where a slot WAS filed, the other slot is a plain `todo`
    // bonus, never a `missed` accusation.
    const isMissedMorning = !todayIsOff && otherSlot === 'morning' && slot === 'evening';
    actions.push({
      key: `checkin-${otherSlot}`,
      kind: 'checkin',
      title: CHECKIN_META[otherSlot].title,
      detail: isMissedMorning
        ? 'Pas encore fait ce matin. Tu peux le rattraper tranquillement.'
        : CHECKIN_META[otherSlot].detail,
      href: CHECKIN_META[otherSlot].href,
      state: isMissedMorning ? 'missed' : 'todo',
      emphasis: 'secondary',
    });
  }

  // (5) Due tracking relevé (§28 daily/weekly cadence) — the §32-2 "plan du jour"
  // is the SINGLE place the member looks, so the due process-relevé is surfaced
  // here as a calm nudge. Only the TOP-due instrument is shown (parity with the
  // widget's old `due[0]`): a fresh member is due on every instrument, and a wall
  // of relevé rows would be the very "entassement"/pressure §31.2 forbids. Its
  // dashboard widget (TrackingCoverageWidget) keeps ONLY its coverage gauge — the
  // CTA lives here now, so the same action is never offered twice (ui-review: no
  // overlap). Process-only, never P&L: the anti-leak firewall keeps `lib/tracking`
  // out of the real edge entirely.
  const topDue = dueTracking[0];
  if (topDue) {
    actions.push({
      key: `tracking-${topDue.instrument.key}`,
      kind: 'tracking',
      title: topDue.instrument.title,
      detail: 'Un court relevé de ton process à compléter quand tu veux.',
      href: `/tracking/${topDue.instrument.key}`,
      state: 'todo',
      emphasis: 'secondary',
    });
  }

  // (6) Correction echo (J-AI corrections echo) — when the coach has raised the
  // SAME axis at least twice in the last 30 days, echo it back as a calm,
  // benevolent reminder (never a to-do, never punitive — anti-Black-Hat §31.2).
  // Only the STRONGEST theme is surfaced (themes are sorted count desc), so the
  // panel never turns into a wall of coaching reminders. `info` state = neither
  // to-do nor done; the deep-link points at the surface the latest correction
  // lives on (/journal for a trade, /training for a backtest).
  const topTheme = correctionThemes.find((t) => t.count >= 2);
  if (topTheme) {
    actions.push({
      key: `correction-echo-${topTheme.axis}`,
      kind: 'correction-echo',
      title: 'Un point suivi par ton coach',
      detail: `Ton coach a relevé ${topTheme.count} fois « ${getAxisLabel(topTheme.axis)} » ce mois. Garde ce point en tête aujourd'hui.`,
      href: topTheme.lastSource === 'training' ? '/training' : '/journal',
      state: 'info',
      emphasis: 'secondary',
    });
  }

  // --- Timing highlight (§32-2 "action en cours" + "action suivante") -------
  // Orthogonal to `state`: the FIRST still-pending action (todo or missed) is
  // the one to do now → `current`; the SECOND → `next`. Pure wayfinding, never
  // a countdown/urgency (§2). A meeting (`info`) is never "pending". The filter
  // returns the SAME object references held by `actions`, so tagging them here
  // tags the rendered list (no copy). Done/info actions stay `timing:undefined`.
  const pending = actions.filter((a) => a.state === 'todo' || a.state === 'missed');
  if (pending[0]) pending[0].timing = 'current';
  if (pending[1]) pending[1].timing = 'next';

  // NOTE — the weekly questionnaire CTA and the unread Mark Douglas inbox are
  // intentionally NOT surfaced here: they keep their dedicated, richer dashboard
  // widgets (CalendarStatusWidget / DouglasInboxWidget). This panel owns the
  // TIME-of-day-sensitive actions + due tracking relevés only, so the dashboard
  // never shows the same call-to-action twice (ui-review: no overlap). The
  // `none` calendar state points the member to the questionnaire widget below.

  return {
    todayLabel: capitalizeFirst(formatLocalDate(today)),
    today,
    slot,
    weekStart,
    calendarState,
    todayBlocks,
    actions,
    todayIsOff,
  };
}
