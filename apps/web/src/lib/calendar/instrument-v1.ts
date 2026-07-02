/**
 * §26 Calendrier adaptatif — frozen, versioned weekly-schedule questionnaire
 * instrument (J-C1 data layer).
 *
 * LONGITUDINAL-VALIDITY INVARIANT (non-negotiable, carbone V1.5 mindset §27.7):
 *  - This instrument is STATIC and VERSIONED. Item `id`s and option `value`s
 *    are immutable contracts: once shipped, an id/value is NEVER renamed or
 *    reused for different wording. ANY change to items/options/scale ⇒ a NEW
 *    `version` entry (bump). Stored answers carry their `instrumentVersion`;
 *    answer sets are only ever read back against the instrument they were
 *    captured with. Renaming an id or mutating v1 in place silently breaks
 *    every historical answer set.
 *  - Pure data + pure helpers ONLY. No DB, no env, no `server-only` — this
 *    module is consumed by BOTH the server-side snapshot builder
 *    (lib/calendar/snapshot.ts) and the client wizard (J-C3). It is also
 *    imported by the §21.5/§27.7 anti-leak test, which forbids any real-edge
 *    (P&L) dependency in `lib/calendar/**`.
 *  - ZERO free-text (Q4 default): every item is a closed choice / integer /
 *    boolean grid. No `safeFreeText`, no crisis/injection surface on the
 *    questionnaire — same posture as MindsetCheck §27.
 *  - Posture §2 (BLOQUANT): the questionnaire organises the member's TIME of
 *    practice (availability, sleep, energy, focus, constraints). NO item asks
 *    for or implies a market view, a setup, or a trade decision.
 */

// =============================================================================
// Closed option vocabularies (`as const` — the single source of truth that the
// Zod questionnaire schema + the Postgres enums mirror).
// =============================================================================

/** Item 1 — the member's life situation (drives realistic time budgeting). */
export const CALENDAR_PROFILES = [
  'trader_en_formation',
  'etudiant',
  'salarie',
  'independant',
  'autre',
] as const;
export type CalendarProfile = (typeof CALENDAR_PROFILES)[number];

/**
 * Item 6 — energy-peak slot AND the keys of the availability grids (items 3-4).
 * Mirrors the Postgres `CalendarSlot` enum (morning/afternoon/evening, Q2
 * default 3-slot granularity).
 */
export const CALENDAR_SLOTS = ['morning', 'afternoon', 'evening'] as const;
export type CalendarSlotValue = (typeof CALENDAR_SLOTS)[number];

/** Item 5 — chronotype, frames when sessions/routines are realistic. */
export const CALENDAR_SLEEP_CHRONOTYPES = ['early', 'standard', 'late'] as const;
export type CalendarSleepChronotype = (typeof CALENDAR_SLEEP_CHRONOTYPES)[number];

/** Item 7 — §30 réunions commitment for the week ahead. */
export const CALENDAR_MEETING_COMMITMENTS = ['none', 'occasional', 'regular'] as const;
export type CalendarMeetingCommitment = (typeof CALENDAR_MEETING_COMMITMENTS)[number];

/** Item 8 — where the member wants to put their practice weight this week. */
export const CALENDAR_PRACTICE_FOCI = ['live', 'backtest', 'mark_douglas', 'balanced'] as const;
export type CalendarPracticeFocus = (typeof CALENDAR_PRACTICE_FOCI)[number];

/** Item 9 — optional life constraint that should compress the week. */
export const CALENDAR_WEEK_CONSTRAINTS = ['none', 'travel', 'exams', 'reduced'] as const;
export type CalendarWeekConstraint = (typeof CALENDAR_WEEK_CONSTRAINTS)[number];

/** Item 3 — weekday availability grid keys (Mon→Fri). */
export const CALENDAR_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
export type CalendarWeekday = (typeof CALENDAR_WEEKDAYS)[number];

/** Item 4 — weekend availability grid keys (Sat→Sun). */
export const CALENDAR_WEEKEND_DAYS = ['saturday', 'sunday'] as const;
export type CalendarWeekendDay = (typeof CALENDAR_WEEKEND_DAYS)[number];

/** Session-goal bounds (item 2 — number of live sessions the member targets). */
export const CALENDAR_SESSION_GOAL_MIN = 1;
export const CALENDAR_SESSION_GOAL_MAX = 7;

// =============================================================================
// Instrument item model (discriminated union by `kind`)
// =============================================================================

export interface CalendarChoiceOption {
  /** Immutable opaque value. NEVER renamed/reused across versions. */
  readonly value: string;
  /** FR member-facing label. */
  readonly label: string;
}

interface CalendarItemBase {
  /** Immutable opaque id. NEVER renamed/reused across versions (see header). */
  readonly id: string;
  /** FR member-facing question text. */
  readonly text: string;
  /** Whether the member may leave this item unanswered (only item 9). */
  readonly optional: boolean;
}

export interface CalendarSingleChoiceItem extends CalendarItemBase {
  readonly kind: 'single_choice';
  readonly options: readonly CalendarChoiceOption[];
}

export interface CalendarIntegerItem extends CalendarItemBase {
  readonly kind: 'integer';
  readonly min: number;
  readonly max: number;
}

export interface CalendarAvailabilityItem extends CalendarItemBase {
  readonly kind: 'availability_grid';
  /** Day keys this grid covers (weekdays OR weekend days). */
  readonly days: readonly string[];
  /** Slots toggled per day (always the 3 CalendarSlots). */
  readonly slots: readonly CalendarSlotValue[];
}

export type CalendarInstrumentItem =
  | CalendarSingleChoiceItem
  | CalendarIntegerItem
  | CalendarAvailabilityItem;

export interface CalendarInstrument {
  readonly version: number;
  /** FR member-facing intro: weekly frame + "organises your time, not trades". */
  readonly preamble: string;
  /** Exactly 9 items (closed instrument). */
  readonly items: readonly CalendarInstrumentItem[];
}

// =============================================================================
// Instrument v1 — 9 frozen items
// =============================================================================

function choices(pairs: readonly (readonly [string, string])[]): readonly CalendarChoiceOption[] {
  return pairs.map(([value, label]) => ({ value, label }));
}

const ITEMS_V1: readonly CalendarInstrumentItem[] = [
  {
    id: 'profile',
    kind: 'single_choice',
    optional: false,
    text: 'Quelle est ta situation cette saison ?',
    options: choices([
      ['trader_en_formation', 'Trader en formation à temps plein'],
      ['etudiant', 'Étudiant'],
      ['salarie', 'Salarié'],
      ['independant', 'Indépendant / freelance'],
      ['autre', 'Autre'],
    ]),
  },
  {
    id: 'session_goal',
    kind: 'integer',
    optional: false,
    min: CALENDAR_SESSION_GOAL_MIN,
    max: CALENDAR_SESSION_GOAL_MAX,
    text: 'Combien de sessions de trading veux-tu viser cette semaine ?',
  },
  {
    id: 'weekday_availability',
    kind: 'availability_grid',
    optional: false,
    days: CALENDAR_WEEKDAYS,
    slots: CALENDAR_SLOTS,
    text: 'En semaine (lundi → vendredi), quels créneaux es-tu disponible ?',
  },
  {
    id: 'weekend_availability',
    kind: 'availability_grid',
    optional: false,
    days: CALENDAR_WEEKEND_DAYS,
    slots: CALENDAR_SLOTS,
    text: 'Le week-end (samedi → dimanche), quels créneaux es-tu disponible ?',
  },
  {
    id: 'sleep',
    kind: 'single_choice',
    optional: false,
    text: 'À quel rythme de sommeil tournes-tu en ce moment ?',
    options: choices([
      ['early', 'Lève-tôt (couché tôt, réveil matinal)'],
      ['standard', 'Standard'],
      ['late', 'Couche-tard (réveil plus tardif)'],
    ]),
  },
  {
    id: 'energy_peak',
    kind: 'single_choice',
    optional: false,
    text: 'À quel moment de la journée es-tu le plus concentré ?',
    options: choices([
      ['morning', 'Le matin'],
      ['afternoon', "L'après-midi"],
      ['evening', 'Le soir'],
    ]),
  },
  {
    id: 'meeting_commitment',
    kind: 'single_choice',
    optional: false,
    text: 'À quelle fréquence comptes-tu suivre les réunions Fxmily cette semaine ?',
    options: choices([
      ['none', 'Aucune cette semaine'],
      ['occasional', 'De temps en temps'],
      ['regular', 'Régulièrement'],
    ]),
  },
  {
    id: 'practice_focus',
    kind: 'single_choice',
    optional: false,
    text: 'Sur quoi veux-tu mettre le poids de ta pratique cette semaine ?',
    options: choices([
      ['live', 'Sessions en direct'],
      ['backtest', 'Backtest / entraînement'],
      ['mark_douglas', 'Travail psychologique (Mark Douglas)'],
      ['balanced', 'Un équilibre des trois'],
    ]),
  },
  {
    id: 'constraint',
    kind: 'single_choice',
    optional: true,
    text: 'As-tu une contrainte particulière cette semaine ? (optionnel)',
    options: choices([
      ['none', 'Aucune'],
      ['travel', 'Déplacement / voyage'],
      ['exams', 'Examens / révisions'],
      ['reduced', 'Semaine allégée'],
    ]),
  },
] as const;

export const CALENDAR_INSTRUMENT_V1: CalendarInstrument = {
  version: 1,
  preamble:
    "Ce questionnaire sert à organiser ton TEMPS de pratique cette semaine : sessions, entraînement, réunions, psychologie, repos. Il ne donne aucun avis sur le marché. Il n'y a pas de bonne ni de mauvaise réponse : décris simplement ta disponibilité réelle.",
  items: ITEMS_V1,
} as const;

/** Every shipped instrument version. Append v2+ here, never mutate v1. */
export const CALENDAR_INSTRUMENTS: readonly CalendarInstrument[] = [
  CALENDAR_INSTRUMENT_V1,
] as const;

export const CURRENT_CALENDAR_INSTRUMENT: CalendarInstrument = CALENDAR_INSTRUMENT_V1;

export const CURRENT_CALENDAR_INSTRUMENT_VERSION = CURRENT_CALENDAR_INSTRUMENT.version;

/** Resolve a stored answer set's instrument by its persisted version. */
export function getCalendarInstrument(version: number): CalendarInstrument | undefined {
  return CALENDAR_INSTRUMENTS.find((instrument) => instrument.version === version);
}
