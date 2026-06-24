import { describe, expect, it } from 'vitest';

import { TrackingAxis } from '@/generated/prisma/enums';

import { getAxisLabel, getAxisMeta, TRACKING_AXES, TRACKING_AXIS_IDS } from './axes';

describe('tracking axes taxonomy', () => {
  it('has exactly one entry per Prisma TrackingAxis enum value (no drift)', () => {
    const enumValues = Object.values(TrackingAxis).sort();
    const taxonomyIds = [...TRACKING_AXIS_IDS].sort();
    expect(taxonomyIds).toEqual(enumValues);
  });

  it('covers the full méthodo surface (11 axes, zero loss)', () => {
    expect(TRACKING_AXES).toHaveLength(11);
    const ids = new Set(TRACKING_AXIS_IDS);
    for (const required of [
      'execution',
      'risk_discipline',
      'market_analysis',
      'training',
      'formation',
      'meeting_presence',
      'emotions_confidence',
      'sleep_lifestyle',
      'evening_review',
      'self_work',
      'routine',
    ]) {
      expect(ids.has(required as (typeof TRACKING_AXIS_IDS)[number])).toBe(true);
    }
  });

  it('every axis has a non-empty FR label and description', () => {
    for (const axis of TRACKING_AXES) {
      expect(axis.label.trim().length).toBeGreaterThan(0);
      expect(axis.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('axis ids are unique', () => {
    expect(new Set(TRACKING_AXIS_IDS).size).toBe(TRACKING_AXIS_IDS.length);
  });

  it('getAxisLabel / getAxisMeta resolve, and getAxisLabel never throws', () => {
    expect(getAxisMeta('self_work')?.label).toBe('Travail sur soi');
    expect(getAxisLabel('routine')).toBe('Routine');
  });
});
