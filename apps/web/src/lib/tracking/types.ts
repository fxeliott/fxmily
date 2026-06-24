/**
 * V2 S2 — Universal tracking-engine types.
 *
 * PURE types ONLY (no runtime). Shared by the instrument definitions, the Zod
 * schema builder, the client wizard and the server service. An instrument is a
 * FROZEN, VERSIONED bundle of closed questions (longitudinal invariant, mirror
 * `lib/mindset/instrument.ts`): once shipped, a `(key, version)` and its
 * question `id`s are an immutable contract — ANY wording/scale/option change ⇒
 * a NEW version, never a mutation in place. Trends/coverage are ONLY ever
 * compared intra-version.
 *
 * POSTURE §2: a question captures PROCESS / PSYCHOLOGY — that an act happened or
 * a felt state — NEVER market-analysis content. There is no free-text question
 * kind by design: the whole instrument is closed (zero crisis/injection surface,
 * mirror MindsetCheck §27.6). Every shipped instrument's labels are asserted
 * clean by `detectAMFViolation` in its test.
 */

import type { CaptureContext } from '@/generated/prisma/enums';

import type { TrackingAxisId } from './axes';

export type CaptureContextValue = CaptureContext;

/** Likert / scale bound shared by `likert` and `scale` questions. */
export type ScaleValue = 1 | 2 | 3 | 4 | 5;

export interface ScaleAnchor {
  readonly value: ScaleValue;
  readonly label: string;
}

export interface ChoiceOption {
  /** Immutable opaque value persisted in `responses`. */
  readonly value: string;
  /** FR display label. */
  readonly label: string;
}

interface BaseQuestion {
  /** Immutable opaque id. NEVER renamed/reused across versions (see header). */
  readonly id: string;
  /** FR statement, framed by the instrument preamble. */
  readonly label: string;
  /** Optional one-line FR helper shown under the label. */
  readonly help?: string;
  /**
   * When false, the member may leave this question unanswered (the response
   * key is then absent). Defaults to true. A skipped optional question never
   * counts against completeness. */
  readonly required?: boolean;
}

/** Yes/No discipline signal (e.g. "as-tu coupé à 20h ?"). Persisted as boolean. */
export interface BooleanQuestion extends BaseQuestion {
  readonly kind: 'boolean';
}

/** 1..5 frequency self-assessment (no right/wrong). Persisted as 1..5 integer. */
export interface LikertQuestion extends BaseQuestion {
  readonly kind: 'likert';
  /** Exactly 5 anchors, values 1..5 ascending. */
  readonly anchors: readonly ScaleAnchor[];
}

/** 1..5 magnitude scale (e.g. confidence). Persisted as 1..5 integer. */
export interface ScaleQuestion extends BaseQuestion {
  readonly kind: 'scale';
  readonly min: ScaleValue;
  readonly max: ScaleValue;
  /** FR labels for the extremes only (e.g. "Faible" / "Élevée"). */
  readonly minLabel: string;
  readonly maxLabel: string;
}

/** Single pick among closed options. Persisted as the chosen `value` string. */
export interface SingleChoiceQuestion extends BaseQuestion {
  readonly kind: 'single_choice';
  readonly options: readonly ChoiceOption[];
}

/** Multiple picks among closed options. Persisted as a `value[]` array. */
export interface MultiTagQuestion extends BaseQuestion {
  readonly kind: 'multi_tag';
  readonly options: readonly ChoiceOption[];
  /** Optional cap on selected tags (UI + Zod). */
  readonly maxSelected?: number;
}

/** Bounded number (e.g. minutes, hours). Persisted as a number. */
export interface NumericQuestion extends BaseQuestion {
  readonly kind: 'numeric';
  readonly min: number;
  readonly max: number;
  /** FR unit suffix (e.g. "min", "h"). */
  readonly unit?: string;
  /** When true, only integers are accepted (Zod `.int()`). */
  readonly integer?: boolean;
}

export type TrackingQuestion =
  | BooleanQuestion
  | LikertQuestion
  | ScaleQuestion
  | SingleChoiceQuestion
  | MultiTagQuestion
  | NumericQuestion;

export type TrackingQuestionKind = TrackingQuestion['kind'];

/** One captured answer value (matches the question kind, see schema.ts). */
export type TrackingAnswerValue = boolean | number | string | readonly string[];

/** Persisted `responses` shape: questionId → answer. */
export type TrackingResponses = Record<string, TrackingAnswerValue>;

/**
 * How often an instrument recurs. Drives `occurrenceKey` and `nextDueAt`
 * (lib/tracking/cadence.ts). `per_trade` is event-bound (no schedule sweep);
 * `manual` is member-initiated only.
 */
export type TrackingCadence =
  | { readonly kind: 'daily' }
  | { readonly kind: 'weekly'; readonly anchorDow: 0 | 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly kind: 'per_trade' }
  | { readonly kind: 'manual' };

/**
 * A frozen, versioned tracking instrument. The DB stores only captured
 * responses + this `(key, version)` pin; the body lives here forever.
 */
export interface TrackingInstrument {
  /** Stable slug, e.g. "process-fidelity". Immutable across versions. */
  readonly key: string;
  /** Semver-ish version, e.g. "v1". A change ⇒ a NEW version, never a mutation. */
  readonly version: string;
  /** The single axis this instrument feeds. */
  readonly axis: TrackingAxisId;
  /** FR member-facing title. */
  readonly title: string;
  /** FR intro: frames the instrument as process, non-judgemental (§31.2). */
  readonly preamble: string;
  /** Recurrence cadence. */
  readonly cadence: TrackingCadence;
  /** Default reliability context stamped when the engine prompts a capture. */
  readonly defaultCaptureContext: CaptureContextValue;
  /**
   * When true, the wizard appends the standard D3 confidence scale (1..5),
   * persisted into `TrackingEntry.confidenceLevel` (NOT into `responses`). */
  readonly capturesConfidence: boolean;
  /** Closed questions. At least one. */
  readonly questions: readonly TrackingQuestion[];
}
