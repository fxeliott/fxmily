// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IOSInstallHint } from './ios-install-hint';

/**
 * `<IOSInstallHint>` contract tests — J8 criterion 1 ("bandeau install visible").
 *
 * WHY THESE LIVE IN VITEST AND NOT ONLY IN PLAYWRIGHT: the e2e proof of this
 * banner (`tests/e2e/j8-pwa-offline.spec.ts`) is WebKit-only by construction, and
 * `e2e.yml` runs the chromium project — so it executes ONLY in
 * `E2E Mobile (golden path)`, a job deliberately absent from `main`'s required
 * status checks (verified: `gh api .../branches/main/protection` →
 * `["Lint, type-check, build", "Analyze (javascript-typescript)",
 * "Playwright (chromium)"]`). A regression that deleted the banner, broke its
 * accessible name or repointed its CTA would therefore have shipped with three
 * green required checks. Vitest runs INSIDE `Lint, type-check, build`
 * (`ci.yml` → `pnpm --filter @fxmily/web test:coverage`), so the promises pinned
 * here genuinely block a merge.
 *
 * Mirrors the discipline of the twin `a2hs-hint.test.tsx` (Chromium counterpart).
 */

const STORAGE_KEY = 'fxmily.ios-a2hs.dismissed';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';

/** Stub the UA + touch/standalone signals `platform.ts` reads. */
function stubClient(ua: string, { maxTouchPoints = 5, standalone = false } = {}) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'standalone', {
    value: standalone,
    configurable: true,
  });
}

const banner = () => screen.queryByRole('region', { name: 'Installer Fxmily sur iPhone' });

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('IOSInstallHint — surface montrée au membre iPhone', () => {
  it('affiche le bandeau sur iOS Safari non-standalone, avec son nom accessible exact', async () => {
    stubClient(IPHONE_SAFARI);
    render(<IOSInstallHint />);
    // `getServerSnapshot` renvoie "dismissed" → rien au premier paint, puis le
    // store se resynchronise après hydratation. D'où le `waitFor`.
    await waitFor(() => expect(banner()).toBeInTheDocument());
  });

  it('pointe vers la page d’étapes /install (le CTA du parcours J8)', async () => {
    stubClient(IPHONE_SAFARI);
    render(<IOSInstallHint />);
    await waitFor(() => expect(banner()).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Voir' })).toHaveAttribute('href', '/install');
  });

  it('porte data-slot="ios-install-hint" — contrat dont dépend l’arbitrage CSS du slot bas', async () => {
    // jsdom ne calcule pas `:has()`, donc les 5 règles de dégagement de
    // globals.css sont prouvées ailleurs (bottom-slot-arbitration.test.ts pour
    // l'enrôlement, Playwright pour le rendu). Ici on verrouille l'attribut
    // sans lequel aucune de ces règles ne peut matcher.
    stubClient(IPHONE_SAFARI);
    render(<IOSInstallHint />);
    await waitFor(() => expect(banner()).toBeInTheDocument());
    expect(banner()).toHaveAttribute('data-slot', 'ios-install-hint');
  });

  it('reste silencieux sur Chrome iOS — ce navigateur ne peut pas faire "Sur l’écran d’accueil"', async () => {
    stubClient(IPHONE_CHROME);
    render(<IOSInstallHint />);
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
  });

  it('reste silencieux sur un vrai Mac (UA Macintosh, 0 point de contact)', async () => {
    stubClient(MAC_SAFARI, { maxTouchPoints: 0 });
    render(<IOSInstallHint />);
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
  });

  it('s’affiche sur un iPad en mode bureau (UA Macintosh + points de contact)', async () => {
    // Régression réelle possible : sans le passage de `maxTouchPoints` au
    // call-site, l'iPadOS Safari « desktop-mode » n'aurait jamais vu le bandeau.
    stubClient(MAC_SAFARI, { maxTouchPoints: 5 });
    render(<IOSInstallHint />);
    await waitFor(() => expect(banner()).toBeInTheDocument());
  });

  it('reste silencieux quand l’app tourne déjà installée (navigator.standalone)', async () => {
    stubClient(IPHONE_SAFARI, { standalone: true });
    render(<IOSInstallHint />);
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
  });

  it('ne réapparaît pas quand le membre a déjà fermé le bandeau', async () => {
    stubClient(IPHONE_SAFARI);
    window.localStorage.setItem(STORAGE_KEY, '1');
    render(<IOSInstallHint />);
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
  });

  it('se ferme et persiste le dismiss au clic sur la croix', async () => {
    stubClient(IPHONE_SAFARI);
    render(<IOSInstallHint />);
    await waitFor(() => expect(banner()).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });
});
