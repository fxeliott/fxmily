import { describe, expect, it } from 'vitest';

import { GUIDE_CATALOG, memberNavHrefs } from './guide-catalog';

/**
 * SSOT coverage guard — the HEART of the guide catalogue.
 *
 * `memberNavHrefs()` is derived LIVE from `nav-items.ts` (NAV_GROUPS non-admin +
 * BOTTOM_NAV, deduplicated). The catalogue must carry exactly one entry per
 * member surface. This test therefore BREAKS the moment a future member route is
 * added to the nav without a matching guide entry — it lists the missing hrefs
 * so the wiring is unmissable.
 */
describe('guide catalogue — member route coverage', () => {
  it('has a guide entry for EVERY member nav route (fails listing the gaps)', () => {
    const hrefs = memberNavHrefs();
    const covered = new Set(GUIDE_CATALOG.map((entry) => entry.href));
    const missing = hrefs.filter((href) => !covered.has(href));

    expect(
      missing,
      `Member routes without a guide entry: ${missing.join(', ') || '(none)'}`,
    ).toEqual([]);
  });

  it('maps each member route to EXACTLY one entry (no duplicates)', () => {
    for (const href of memberNavHrefs()) {
      const matches = GUIDE_CATALOG.filter((entry) => entry.href === href);
      expect(
        matches.length,
        `Expected exactly 1 guide entry for ${href}, found ${matches.length}`,
      ).toBe(1);
    }
  });

  it('has no orphan entry pointing to a non-member route', () => {
    const memberHrefs = new Set(memberNavHrefs());
    const orphans = GUIDE_CATALOG.filter((entry) => !memberHrefs.has(entry.href)).map(
      (entry) => entry.href,
    );

    expect(
      orphans,
      `Guide entries not backed by a member nav route: ${orphans.join(', ')}`,
    ).toEqual([]);
  });
});

describe('memberNavHrefs — derivation from nav-items.ts', () => {
  it('is deduplicated', () => {
    const hrefs = memberNavHrefs();
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('never leaks an admin route to members', () => {
    expect(memberNavHrefs().some((href) => href.startsWith('/admin'))).toBe(false);
  });
});

describe('guide catalogue — entry shape', () => {
  it('every entry has a non-empty title, blurb and group', () => {
    for (const entry of GUIDE_CATALOG) {
      expect(entry.title.trim().length, `title for ${entry.href}`).toBeGreaterThan(0);
      expect(entry.blurb.trim().length, `blurb for ${entry.href}`).toBeGreaterThan(0);
      expect(entry.group.trim().length, `group for ${entry.href}`).toBeGreaterThan(0);
    }
  });

  it('every href is unique within the catalogue', () => {
    const hrefs = GUIDE_CATALOG.map((entry) => entry.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
