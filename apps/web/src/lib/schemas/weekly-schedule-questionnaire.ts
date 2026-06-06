/**
 * §26 Calendrier adaptatif — Zod schema for the weekly-schedule questionnaire
 * INPUT (member answers, J-C1).
 *
 * ZERO free-text (Q4 default): every field is a closed enum / bounded integer /
 * boolean grid. There is therefore NO `safeFreeText` / `containsBidiOrZeroWidth`
 * import here — the questionnaire has no crisis/injection surface by design
 * (same posture as MindsetCheck §27). Allowed values mirror the frozen
 * instrument (`lib/calendar/instrument-v1.ts`) — the single source of truth.
 */

import { z } from 'zod';

import {
  CALENDAR_MEETING_COMMITMENTS,
  CALENDAR_PRACTICE_FOCI,
  CALENDAR_PROFILES,
  CALENDAR_SESSION_GOAL_MAX,
  CALENDAR_SESSION_GOAL_MIN,
  CALENDAR_SLEEP_CHRONOTYPES,
  CALENDAR_SLOTS,
  CALENDAR_WEEK_CONSTRAINTS,
} from '@/lib/calendar/instrument-v1';

/**
 * One day's three-slot availability. `.strict()` rejects hallucinated keys.
 * Exported so a cross-integrity test can pin its keys to `CALENDAR_SLOTS`
 * (these grids hardcode keys for precise typing — the test guards v2 drift).
 */
export const daySlotsSchema = z
  .object({
    morning: z.boolean(),
    afternoon: z.boolean(),
    evening: z.boolean(),
  })
  .strict();

export type DaySlotsAvailability = z.infer<typeof daySlotsSchema>;

/** Weekday grid (Mon→Fri). Keys frozen — mirrors `CALENDAR_WEEKDAYS`. */
export const weekdayAvailabilitySchema = z
  .object({
    monday: daySlotsSchema,
    tuesday: daySlotsSchema,
    wednesday: daySlotsSchema,
    thursday: daySlotsSchema,
    friday: daySlotsSchema,
  })
  .strict();

/** Weekend grid (Sat→Sun). Keys frozen — mirrors `CALENDAR_WEEKEND_DAYS`. */
export const weekendAvailabilitySchema = z
  .object({
    saturday: daySlotsSchema,
    sunday: daySlotsSchema,
  })
  .strict();

/**
 * The 9 closed answers. `.strict()` rejects any extra key (no smuggled
 * free-text / P&L). `constraint` defaults to `'none'` so the wizard may omit
 * the optional item (item 9) while the stored record stays complete.
 */
export const weeklyScheduleResponsesSchema = z
  .object({
    profile: z.enum(CALENDAR_PROFILES),
    sessionGoal: z.number().int().min(CALENDAR_SESSION_GOAL_MIN).max(CALENDAR_SESSION_GOAL_MAX),
    weekdayAvailability: weekdayAvailabilitySchema,
    weekendAvailability: weekendAvailabilitySchema,
    sleep: z.enum(CALENDAR_SLEEP_CHRONOTYPES),
    energyPeak: z.enum(CALENDAR_SLOTS),
    meetingCommitment: z.enum(CALENDAR_MEETING_COMMITMENTS),
    practiceFocus: z.enum(CALENDAR_PRACTICE_FOCI),
    constraint: z.enum(CALENDAR_WEEK_CONSTRAINTS).default('none'),
  })
  .strict();

export type WeeklyScheduleResponses = z.infer<typeof weeklyScheduleResponsesSchema>;

/**
 * Full service-layer input. `weekStart` is a `YYYY-MM-DD` local date string
 * (Monday Europe/Paris) — the service re-pins it to UTC-midnight via
 * `parseLocalDate` before the `@db.Date` write (anti-flake PR#96). Never
 * trust a client-supplied `weekStart` for the DB instant.
 */
export const submitWeeklyScheduleInputSchema = z
  .object({
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStart must be a YYYY-MM-DD local date'),
    responses: weeklyScheduleResponsesSchema,
  })
  .strict();

export type SubmitWeeklyScheduleInput = z.infer<typeof submitWeeklyScheduleInputSchema>;
