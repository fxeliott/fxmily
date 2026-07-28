import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GUIDE_CATALOG,
  GUIDE_ROUTE_EXEMPTIONS,
  guideEntryIcon,
  memberNavHrefs,
  navIconByHref,
} from './guide-catalog';

import { BOTTOM_NAV, NAV_GROUPS } from '@/components/nav/nav-items';

/**
 * SSOT coverage guard — the HEART of the guide catalogue.
 *
 * Two INDEPENDENT angles, because the first one alone was measuring the wrong
 * thing:
 *
 *   Block A — the nav. `memberNavHrefs()` is derived live from `nav-items.ts`;
 *             the catalogue must carry exactly one entry per nav surface.
 *   Block B — the REALITY. The `src/app` tree is walked: every non-admin
 *             `page.tsx` must be explained by an entry (itself, a descendant of
 *             one, or a declared `covers` prefix) or be listed in
 *             `GUIDE_ROUTE_EXEMPTIONS` with a reason.
 *
 * Block B exists because Block A can only ever prove the guide covers the NAV.
 * A real member route that never made it into the nav was a hole in the guide
 * that the green test could not see — and that was not hypothetical: `/install`,
 * created by J8 and linked from this very guide, was invisible to it.
 */

// -----------------------------------------------------------------------------
// Route-tree walker — the reality this guard measures
// -----------------------------------------------------------------------------

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));

/**
 * Every route that has a `page` file under `src/app`, in Next.js App Router
 * terms: directories starting with `_` are private, `api` holds route handlers
 * (not pages), and `(group)` segments are organisational and contribute no path
 * segment.
 */
function pageRoutes(): string[] {
  const routes: string[] = [];

  const walk = (dir: string, segment: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'api' || entry.name.startsWith('_')) continue;
        const isRouteGroup = entry.name.startsWith('(') && entry.name.endsWith(')');
        walk(child, isRouteGroup ? segment : `${segment}/${entry.name}`);
      } else if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        routes.push(segment === '' ? '/' : segment);
      }
    }
  };

  walk(APP_DIR, '');
  return routes.sort();
}

/** Non-admin page routes — the member-reachable surface of the app. */
function memberPageRoutes(): string[] {
  return pageRoutes().filter((route) => !route.startsWith('/admin'));
}

/** `/journal` explains `/journal/new`; it does NOT explain `/journalier`. */
function isUnder(route: string, prefix: string): boolean {
  return route === prefix || route.startsWith(`${prefix}/`);
}

/** The prefixes a catalogue entry claims to explain. */
function claimedPrefixes(): string[] {
  return GUIDE_CATALOG.flatMap((entry) => [entry.href, ...(entry.covers ?? [])]);
}

// -----------------------------------------------------------------------------
// Block A — coverage of the nav
// -----------------------------------------------------------------------------

describe('guide catalogue — member route coverage (nav)', () => {
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
});

// -----------------------------------------------------------------------------
// Block B — coverage of the REAL route tree
// -----------------------------------------------------------------------------

describe('guide catalogue — member route coverage (real route tree)', () => {
  it('walks a plausible tree (anti-vacuity: an empty walk must NOT pass)', () => {
    const all = pageRoutes();
    const member = memberPageRoutes();

    // Hard floors, not equalities: the suite must not need editing every time a
    // route is added, but a walker that silently found nothing cannot go green.
    expect(all.length, 'page routes found under src/app').toBeGreaterThan(60);
    expect(member.length, 'non-admin page routes').toBeGreaterThan(45);
    expect(
      all.length - member.length,
      'admin page routes (proves the admin filter has something to filter)',
    ).toBeGreaterThan(10);

    // Landmarks: three routes that must exist for the walk to be meaningful —
    // a root page, a nested one, and a dynamic segment.
    for (const landmark of ['/', '/checkin/morning', '/journal/[id]']) {
      expect(all, `landmark route ${landmark}`).toContain(landmark);
    }
  });

  it('explains or explicitly exempts EVERY real member page (fails listing them)', () => {
    const prefixes = claimedPrefixes();
    const unexplained = memberPageRoutes().filter(
      (route) =>
        !(route in GUIDE_ROUTE_EXEMPTIONS) && !prefixes.some((prefix) => isUnder(route, prefix)),
    );

    expect(
      unexplained,
      `Real member pages neither explained by a guide entry nor exempted:\n  ${unexplained.join('\n  ')}\n` +
        `Fix by adding a GUIDE_CATALOG entry, a \`covers\` prefix on the entry that ` +
        `already explains it, or a documented GUIDE_ROUTE_EXEMPTIONS reason.`,
    ).toEqual([]);
  });

  it('has no exemption for a route that no longer exists (the list cannot rot)', () => {
    const real = new Set(memberPageRoutes());
    const stale = Object.keys(GUIDE_ROUTE_EXEMPTIONS).filter((route) => !real.has(route));

    expect(stale, `Exemptions pointing at non-existent routes: ${stale.join(', ')}`).toEqual([]);
  });

  it('gives every exemption a non-empty reason', () => {
    for (const [route, reason] of Object.entries(GUIDE_ROUTE_EXEMPTIONS)) {
      expect(reason.trim().length, `reason for ${route}`).toBeGreaterThan(0);
    }
  });

  it('never exempts an admin route (they are out of scope by construction)', () => {
    const admins = Object.keys(GUIDE_ROUTE_EXEMPTIONS).filter((route) =>
      route.startsWith('/admin'),
    );
    expect(
      admins,
      `Admin routes do not belong in the exemption list: ${admins.join(', ')}`,
    ).toEqual([]);
  });

  it('points every entry href at a route that really exists', () => {
    const real = new Set(memberPageRoutes());
    const dangling = GUIDE_CATALOG.map((entry) => entry.href).filter((href) => !real.has(href));

    expect(
      dangling,
      `Guide entries linking to a non-existent member page: ${dangling.join(', ')}`,
    ).toEqual([]);
  });

  it('declares no `covers` prefix that explains nothing (dead declaration)', () => {
    const routes = memberPageRoutes();
    const dead: string[] = [];

    for (const entry of GUIDE_CATALOG) {
      for (const prefix of entry.covers ?? []) {
        // A `covers` prefix earns its place only if it explains a real page that
        // the entry's own href does not already reach.
        const explains = routes.some(
          (route) => isUnder(route, prefix) && !isUnder(route, entry.href),
        );
        if (!explains) dead.push(`${entry.href} covers ${prefix}`);
      }
    }

    expect(dead, `Dead \`covers\` declarations: ${dead.join(', ')}`).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// Derivation + entry shape
// -----------------------------------------------------------------------------

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
  it('every entry has a non-empty title, blurb, when and group', () => {
    for (const entry of GUIDE_CATALOG) {
      expect(entry.title.trim().length, `title for ${entry.href}`).toBeGreaterThan(0);
      expect(entry.blurb.trim().length, `blurb for ${entry.href}`).toBeGreaterThan(0);
      expect(entry.when.trim().length, `when for ${entry.href}`).toBeGreaterThan(0);
      expect(entry.group.trim().length, `group for ${entry.href}`).toBeGreaterThan(0);
    }
  });

  it('answers a DIFFERENT question in `when` than in `blurb`', () => {
    // The milestone asks for "à quoi ça sert, quand" — two answers. Copying the
    // blurb into `when` would satisfy the non-empty check while delivering one.
    for (const entry of GUIDE_CATALOG) {
      expect(entry.when.trim(), `when for ${entry.href} duplicates its blurb`).not.toBe(
        entry.blurb.trim(),
      );
    }
  });

  it('writes `when` as a real sentence, not a stub', () => {
    for (const entry of GUIDE_CATALOG) {
      // Short enough to scan on a card, long enough to actually say when.
      expect(
        entry.when.trim().length,
        `when for ${entry.href} is too short to inform`,
      ).toBeGreaterThan(24);
      expect(
        entry.when.trim().length,
        `when for ${entry.href} is too long for a card`,
      ).toBeLessThan(140);
    }
  });

  it('every href is unique within the catalogue', () => {
    const hrefs = GUIDE_CATALOG.map((entry) => entry.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

// -----------------------------------------------------------------------------
// Repère visuel — un glyphe par entrée, sans seconde source de vérité
// -----------------------------------------------------------------------------

describe('guide catalogue — visual anchor', () => {
  it('resolves an icon for EVERY entry (fails listing the ones without)', () => {
    const iconless = GUIDE_CATALOG.filter((entry) => guideEntryIcon(entry) === null).map(
      (entry) => entry.href,
    );

    expect(
      iconless,
      `Guide entries with no visual anchor: ${iconless.join(', ')}\n` +
        `Fix by adding the route to nav-items.ts (preferred — the nav glyph is the ` +
        `single source of truth) or, for a surface that legitimately has no nav ` +
        `entry, by declaring \`icon\` on the catalogue entry.`,
    ).toEqual([]);
  });

  it('never declares an `icon` on an entry the nav already covers (no second SSOT)', () => {
    const navIcons = navIconByHref();
    const duplicated = GUIDE_CATALOG.filter((entry) => entry.icon && navIcons.has(entry.href)).map(
      (entry) => entry.href,
    );

    expect(
      duplicated,
      `These entries declare their own icon while nav-items.ts already defines one — ` +
        `the two could drift apart and show different glyphs for the same screen: ` +
        `${duplicated.join(', ')}`,
    ).toEqual([]);
  });

  it('takes the glyph nav-items.ts DECLARES, not one derived from itself', () => {
    // Oracle INDÉPENDANT : on relit `nav-items.ts` à la main plutôt que de
    // réutiliser `navIconByHref()`. Comparer `guideEntryIcon(entry)` à
    // `navIconByHref().get(href)` serait une tautologie — c'est littéralement la
    // définition de la fonction (`guide-catalog.ts`), donc l'assertion ne
    // pourrait jamais échouer. En repartant de la structure source, une
    // régression DANS la dérivation elle-même (mauvais filtre `admin`, priorité
    // BOTTOM_NAV/NAV_GROUPS inversée, href mal recopié) devient visible.
    const declared = new Map<string, unknown>();
    for (const group of NAV_GROUPS) {
      if (group.admin) continue;
      for (const item of group.items) {
        if (item.admin) continue;
        if (!declared.has(item.href)) declared.set(item.href, item.icon);
      }
    }
    for (const item of BOTTOM_NAV) {
      if (item.admin) continue;
      if (!declared.has(item.href)) declared.set(item.href, item.icon);
    }

    for (const entry of GUIDE_CATALOG) {
      const fromNav = declared.get(entry.href);
      if (!fromNav) continue;
      expect(guideEntryIcon(entry), `glyphe rendu pour ${entry.href}`).toBe(fromNav);
    }
  });

  it('pins a few landmark glyphes by name (external oracle, survives a refactor)', () => {
    // Trois ancres écrites à la main : elles ne dépendent d'AUCUNE dérivation.
    // Si la résolution se met un jour à renvoyer « une icône qui ressemble »,
    // c'est ici que ça casse, y compris si toute la mécanique interne change.
    const expected: Record<string, string> = {
      '/dashboard': 'LayoutDashboard',
      '/journal': 'BookOpen',
      // La seule entrée sans contrepartie dans la nav : elle passe par le champ
      // `icon` de l'entrée, l'autre branche de la résolution.
      '/install': 'Smartphone',
    };

    for (const [href, displayName] of Object.entries(expected)) {
      const entry = GUIDE_CATALOG.find((e) => e.href === href);
      expect(entry, `entrée de catalogue pour ${href}`).toBeDefined();
      const icon = guideEntryIcon(entry!) as { displayName?: string } | null;
      expect(icon?.displayName, `glyphe attendu pour ${href}`).toBe(displayName);
    }
  });

  it('derives an icon for every member nav route (anti-vacuity)', () => {
    const hrefs = memberNavHrefs();
    const icons = navIconByHref();

    // A silently empty map would make the first test pass only via the declared
    // `icon` escape hatch — i.e. exactly the second source of truth we forbid.
    expect(icons.size, 'nav icons derived').toBe(hrefs.length);
    for (const href of hrefs) {
      expect(icons.get(href), `nav icon for ${href}`).toBeTruthy();
    }
    expect([...icons.keys()].some((href) => href.startsWith('/admin'))).toBe(false);
  });
});
