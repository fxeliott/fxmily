import { describe, expect, it } from 'vitest';

import { HABIT_KIND_ENTRIES } from './habit-kinds';
import { isLogExpressHidden } from './log-express-fab';

describe('isLogExpressHidden', () => {
  it('hides on the root splash and public/unauthenticated routes', () => {
    for (const p of [
      '/',
      '/login',
      '/onboarding',
      '/onboarding/welcome',
      '/forgot-password',
      '/reset-password',
      '/reset-password/abc',
      '/legal',
      '/legal/privacy',
    ]) {
      expect(isLogExpressHidden(p)).toBe(true);
    }
  });

  it('hides on every wizard destination (anti-recursion / anti-clutter)', () => {
    for (const p of [
      '/track/sleep/new',
      '/track/nutrition/new',
      '/track/caffeine/new',
      '/track/sport/new',
      '/track/meditation/new',
      '/checkin/morning',
      '/checkin/evening',
      '/journal/new',
      '/review/new',
      '/reflect/new',
      '/journal/clx123abc/close',
    ]) {
      expect(isLogExpressHidden(p)).toBe(true);
    }
  });

  it('shows on authenticated app screens (the FAB belongs here)', () => {
    for (const p of [
      '/dashboard',
      '/track',
      '/journal',
      '/journal/clx123abc',
      '/library',
      '/library/anything-can-happen',
      '/account',
      '/account/notifications',
      '/admin/members',
      '/admin/reports',
      '/checkin',
      '/review',
      '/reflect',
    ]) {
      expect(isLogExpressHidden(p)).toBe(false);
    }
  });

  it('matches on path segments, never on substrings', () => {
    // `/login` must not swallow a hypothetical `/loginhistory`
    expect(isLogExpressHidden('/loginhistory')).toBe(false);
    expect(isLogExpressHidden('/trackrecord')).toBe(false);
    // a non-close journal sub-route stays visible
    expect(isLogExpressHidden('/journal/clx123abc/edit')).toBe(false);
  });

  it('also suppresses any descendant of a wizard path (defensive)', () => {
    // No such sub-routes exist today, but a child of a wizard dest must
    // never resurface the FAB inside a wizard flow.
    expect(isLogExpressHidden('/track/sleep/new/anything')).toBe(true);
    expect(isLogExpressHidden('/onboarding/welcome/step')).toBe(true);
  });

  // The REAL anti-recursion invariant: every pillar the FAB can navigate
  // to MUST be a route where the FAB hides itself — otherwise the FAB
  // would render inside the very wizard it just opened. This couples the
  // two hand-maintained lists (HABIT_KIND_ENTRIES ↔ HIDDEN_PREFIXES) so a
  // future 6th pillar can't silently re-introduce recursion.
  it('hides on every wizard href reachable from the FAB itself', () => {
    expect(HABIT_KIND_ENTRIES.length).toBeGreaterThan(0);
    for (const entry of HABIT_KIND_ENTRIES) {
      expect(isLogExpressHidden(entry.href)).toBe(true);
    }
  });
});
