import { describe, expect, it } from 'vitest';

import { isNavItemActive, NAV_GROUPS } from './nav-items';

/**
 * F7 Layer 2 — `/checkin/history` is a nav sibling of `/checkin`, so the active
 * logic must pick the MOST SPECIFIC item (no double-highlight) while keeping the
 * parent lit on sub-routes that are NOT nav items (the wizards).
 */
describe('isNavItemActive', () => {
  it('lights the exact match', () => {
    expect(isNavItemActive('/checkin', '/checkin')).toBe(true);
    expect(isNavItemActive('/checkin/history', '/checkin/history')).toBe(true);
  });

  it('keeps the parent active on a sub-route that is NOT a nav item (wizards)', () => {
    expect(isNavItemActive('/checkin/morning', '/checkin')).toBe(true);
    expect(isNavItemActive('/checkin/evening', '/checkin')).toBe(true);
  });

  it('does NOT light the parent when a deeper nav item matches (most-specific wins)', () => {
    // The core F7 fix: on /checkin/history only ONE item lights up.
    expect(isNavItemActive('/checkin/history', '/checkin')).toBe(false);
    expect(isNavItemActive('/checkin/history', '/checkin/history')).toBe(true);
  });

  it('keeps /dashboard exact-only (never lit on deep routes)', () => {
    expect(isNavItemActive('/dashboard', '/dashboard')).toBe(true);
    expect(isNavItemActive('/checkin', '/dashboard')).toBe(false);
    expect(isNavItemActive('/dashboard/x', '/dashboard')).toBe(false);
  });

  it('requires a segment boundary (no substring false positive)', () => {
    expect(isNavItemActive('/tracking', '/track')).toBe(false);
    expect(isNavItemActive('/track/habits', '/track')).toBe(true);
  });

  it('keeps a parent active on a detail sub-route with no deeper nav item', () => {
    // /admin/members/[id] is not itself a nav item → /admin/members stays lit.
    expect(isNavItemActive('/admin/members/abc123', '/admin/members')).toBe(true);
  });
});

/**
 * 2026-07-07 audit — /admin/a-traiter (triage queue) and /admin/invite (member
 * invitation) are real, shipped admin surfaces that were reachable ONLY via the
 * /admin hub, never from the sidebar/drawer/⌘K. Guard against that class of
 * wayfinding drift: every admin operating surface must live in the Admin group.
 */
describe('NAV_GROUPS admin coverage', () => {
  it('exposes every admin operating surface in the Admin group (no orphan surfaces)', () => {
    const adminGroup = NAV_GROUPS.find((g) => g.admin);
    const hrefs = adminGroup?.items.map((i) => i.href) ?? [];
    for (const href of [
      '/admin/members',
      '/admin/a-traiter',
      '/admin/access-requests',
      '/admin/invite',
      '/admin/cards',
      '/admin/reunions',
      '/admin/seances',
      '/admin/reports',
      '/admin/health',
      '/admin/system',
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it('marks every Admin group item admin-only (never leaks to members)', () => {
    const adminGroup = NAV_GROUPS.find((g) => g.admin);
    expect(adminGroup?.items.every((i) => i.admin === true)).toBe(true);
  });
});
