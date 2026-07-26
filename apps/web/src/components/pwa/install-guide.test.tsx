// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstallGuide } from './install-guide';

/**
 * `<InstallGuide>` — the `/install` page's whole content, one test per platform
 * branch. J8 criterion 1 ("page d'étapes ... + équivalents Android/desktop").
 *
 * ## Why this file exists
 *
 * `/install` shipped with ZERO component tests, and the J8 audit found the cost:
 * "desktop" was treated as ONE experience when it is four, three of which cannot
 * follow the instructions being shown. Concretely, a member on Safari macOS was
 * told to open a "⋮ menu, to the right of the address bar" — Safari has no such
 * menu — and then to pick "Installer Fxmily", an entry that does not exist there
 * (the real path is Fichier ▸ Ajouter au Dock…). A member on Firefox desktop was
 * given three confident steps for something Firefox cannot do at all.
 *
 * Nothing could catch that: type-check is happy with a wrong string, and the e2e
 * suite drives Chromium and WebKit-iPhone only — never Safari-desktop, never
 * Firefox. So the guard has to live HERE, in Vitest, which runs inside the
 * required `Lint, type-check, build` check.
 *
 * ## What each test pins
 *
 * Every branch asserts BOTH directions: the copy that must appear, and — for the
 * cases the audit got wrong — the copy that must NOT. A test that only checks
 * "Safari sees Add to Dock" would still pass if Safari also saw the Chromium
 * steps underneath.
 */

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  unknown: 'SomeKiosk/3.2 (Embedded)',
} as const;

/**
 * Put the client into a known state: UA, touch points, standalone flag, and
 * whether the engine advertises Chromium's install API.
 *
 * `hasInstallPromptApi` is what `'onbeforeinstallprompt' in window` reads. jsdom
 * never defines it, so `false` is the natural default and `true` must be opted
 * into — the same asymmetry as the real Safari/Firefox engines.
 */
function stubClient(
  ua: string,
  {
    maxTouchPoints = 0,
    standalone = false,
    hasInstallPromptApi = false,
  }: { maxTouchPoints?: number; standalone?: boolean; hasInstallPromptApi?: boolean } = {},
) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'standalone', {
    value: standalone,
    configurable: true,
  });
  if (hasInstallPromptApi) {
    Object.defineProperty(window, 'onbeforeinstallprompt', { value: null, configurable: true });
  } else if ('onbeforeinstallprompt' in window) {
    delete (window as unknown as Record<string, unknown>).onbeforeinstallprompt;
  }
  // `isStandalone()` also consults `display-mode: standalone`; jsdom has no
  // matchMedia at all, so provide one that answers the standalone stub.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: standalone && query === '(display-mode: standalone)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

/** Dispatch Chromium's `beforeinstallprompt` with the surface the guide uses. */
function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string; platform: string }>;
    platforms: string[];
  };
  event.prompt = vi.fn(() => Promise.resolve());
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  event.platforms = ['web'];
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

/** The single install-instruction card, whatever branch produced it. */
const guide = () => screen.getByRole('region', { name: "Installer l'application Fxmily" });
const heading = (name: RegExp) => screen.queryByRole('heading', { level: 2, name });
const body = () => guide().textContent ?? '';

/**
 * Apostrophe-agnostic matcher.
 *
 * The components write `&apos;`, which React renders as U+0027 `'`, while French
 * prose in this file naturally uses the typographic U+2019 `’`. A regex hardcoding
 * either one silently matches NOTHING — and a `queryBy…().toBeNull()` written
 * that way passes even when the element is present. That exact vacuity bit this
 * file during development, so every apostrophe in a matcher goes through here.
 */
const apos = (s: string) => new RegExp(s.replace(/['’]/g, "['’]"), 'i');

/**
 * Copy that belongs to the Chromium branch and to NO other. Used as a negative
 * assertion set: seeing any of these on Safari or Firefox is the J8 defect.
 * Deliberately excludes loose substrings like "barre d'adresse", which legitimately
 * appears in Safari's own copy ("sans barre d'adresse") — a negative assertion has
 * to name the instruction, not a word that happens to occur inside it.
 */
const CHROMIUM_ONLY_COPY = [
  '⋮',
  'trois points',
  "icône d'installation",
  'Diffuser, enregistrer et partager',
] as const;

function expectNoChromiumInstructions() {
  const text = body();
  for (const marker of CHROMIUM_ONLY_COPY) {
    expect(text, `copie Chromium fuitée : « ${marker} »`).not.toContain(marker);
  }
  expect(heading(/^sur ordinateur$/i)).toBeNull();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InstallGuide — la page est toujours rendue', () => {
  it('expose sa région et son titre h1 quel que soit l’appareil', async () => {
    stubClient(UA.unknown);
    render(<InstallGuide />);
    expect(guide()).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: apos("Installe Fxmily sur ton écran d'accueil"),
        }),
      ).toBeInTheDocument(),
    );
  });
});

describe('InstallGuide — iPhone / iPad', () => {
  it('donne les 3 gestes du Share-sheet iOS', async () => {
    stubClient(UA.iphone, { maxTouchPoints: 5 });
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/sur iphone ou ipad/i)).toBeInTheDocument());
    expect(body()).toContain('Partager');
    expect(body()).toContain("Sur l'écran d'accueil");
    expect(body()).toContain('Ajouter');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('n’expose jamais le bouton d’installation en un clic sur iOS', async () => {
    // iOS ne déclenche pas `beforeinstallprompt` : un bouton ici serait mort.
    stubClient(UA.iphone, { maxTouchPoints: 5 });
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/sur iphone ou ipad/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: apos("Installer l'application") })).toBeNull();
    expectNoChromiumInstructions();
  });
});

describe('InstallGuide — Android', () => {
  it('parle du menu ⋮ et des deux libellés possibles', async () => {
    stubClient(UA.android, { maxTouchPoints: 5, hasInstallPromptApi: true });
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/^sur android$/i)).toBeInTheDocument());
    expect(body()).toContain('(⋮)');
    expect(body()).toContain("Installer l'application");
    expect(body()).toContain("Ajouter à l'écran d'accueil");
  });

  it('propose l’installation en un clic dès que le navigateur l’offre, et appelle prompt()', async () => {
    stubClient(UA.android, { maxTouchPoints: 5, hasInstallPromptApi: true });
    render(<InstallGuide />);
    const event = fireBeforeInstallPrompt();
    const btn = await screen.findByRole('button', { name: apos("Installer l'application") });
    fireEvent.click(btn);
    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
  });
});

describe('InstallGuide — desktop Chromium', () => {
  it('pointe d’abord la barre d’adresse (l’affordance réelle), le menu en second', async () => {
    stubClient(UA.winChrome, { hasInstallPromptApi: true });
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/sur ordinateur/i)).toBeInTheDocument());
    const text = body();
    expect(text).toContain("barre d'adresse");
    expect(text).toContain('Installer');
    // L'ordre compte : sur Chrome desktop l'icône de la barre d'adresse est le
    // chemin direct ; le menu est le repli, pas l'inverse.
    expect(text.indexOf("barre d'adresse")).toBeLessThan(text.indexOf('menu (⋮)'));
  });

  it('ne parle PAS du menu ⋮ « en haut à droite » (c’est la formulation Android)', async () => {
    stubClient(UA.winChrome, { hasInstallPromptApi: true });
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/sur ordinateur/i)).toBeInTheDocument());
    expect(body()).not.toContain('en haut à droite');
  });
});

describe('InstallGuide — Safari sur macOS (le défaut trouvé au J8)', () => {
  it('donne le VRAI chemin Safari : Fichier ▸ Ajouter au Dock…', async () => {
    stubClient(UA.macSafari); // vrai Mac : 0 point de contact, pas d'API d'install
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/sur mac \(safari\)/i)).toBeInTheDocument());
    const text = body();
    expect(text).toContain('Fichier');
    expect(text).toContain('Ajouter au Dock');
    expect(text).toContain('barre de menus');
  });

  it('énonce la condition macOS Sonoma au lieu de la deviner', async () => {
    // L'UA macOS est figée à 10_15_7 : la version de l'OS est indevinable côté
    // client. On nomme la condition — on ne prétend pas l'avoir détectée.
    stubClient(UA.macSafari);
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/sur mac \(safari\)/i)).toBeInTheDocument());
    expect(body()).toContain('macOS Sonoma');
  });

  it('RÉGRESSION : ne montre AUCUNE instruction Chromium à Safari', async () => {
    // Le défaut exact du J8 : Safari recevait « les trois points, à droite de la
    // barre d'adresse » puis « Choisis Installer Fxmily ». Aucun des deux
    // n'existe dans Safari.
    stubClient(UA.macSafari);
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/sur mac \(safari\)/i)).toBeInTheDocument());
    expectNoChromiumInstructions();
  });
});

describe('InstallGuide — Firefox desktop (impasse honnête)', () => {
  it('dit que Firefox n’installe pas les applications web, sans blâmer le membre', async () => {
    stubClient(UA.winFirefox);
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/sur ce navigateur/i)).toBeInTheDocument());
    const text = body();
    expect(text).toContain("n'installe pas les applications web");
    expect(text).toContain("Ce n'est pas un problème de ton côté");
  });

  it('RÉGRESSION : ne donne AUCUNE étape numérotée pour une action impossible', async () => {
    // MDN : « Firefox does not support installing PWAs using a manifest file. »
    // Trois étapes confiantes envoyaient le membre chercher une entrée de menu
    // qui n'existe pas — et l'app paraissait cassée.
    stubClient(UA.winFirefox);
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/sur ce navigateur/i)).toBeInTheDocument());
    expect(guide().querySelector('ul')).not.toBeNull(); // la liste d'alternatives existe
    expect(guide().querySelector('ol')).toBeNull(); // mais aucune procédure numérotée
    expectNoChromiumInstructions();
  });

  it('oriente vers les deux voies qui marchent vraiment (téléphone, autre navigateur)', async () => {
    stubClient(UA.winFirefox);
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/sur ce navigateur/i)).toBeInTheDocument());
    const text = body();
    expect(text).toContain('Sur ton téléphone');
    expect(text).toContain('Chrome, Edge ou Safari');
  });
});

describe('InstallGuide — navigateur desktop non identifié', () => {
  it('décrit où regarder sans affirmer que l’entrée existe', async () => {
    stubClient(UA.unknown);
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/^sur ordinateur$/i)).toBeInTheDocument());
    const text = body();
    expect(text).toContain("La barre d'adresse");
    expect(text).toContain('Le menu du navigateur');
    // Le repli honnête : et si rien ne s'y trouve ?
    expect(text).toContain('ne propose probablement pas');
  });

  it('bascule sur le parcours Chromium si l’API apparaît malgré un UA inconnu', async () => {
    // La capacité prime sur l'UA : un fork Chromium renommé reste installable.
    stubClient(UA.unknown, { hasInstallPromptApi: true });
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/^sur ordinateur$/i)).toBeInTheDocument());
    expect(body()).toContain("barre d'adresse");
    expect(body()).not.toContain('ne propose probablement pas');
  });
});

describe('InstallGuide — déjà installée', () => {
  it('ne propose rien quand l’app tourne en standalone', async () => {
    stubClient(UA.iphone, { maxTouchPoints: 5, standalone: true });
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/fxmily est déjà installée/i)).toBeInTheDocument());
    expect(guide().querySelector('ol')).toBeNull();
  });

  it('bascule sur la confirmation après l’événement appinstalled', async () => {
    stubClient(UA.winChrome, { hasInstallPromptApi: true });
    render(<InstallGuide />);
    await waitFor(() => expect(heading(/sur ordinateur/i)).toBeInTheDocument());
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    await waitFor(() => expect(heading(/fxmily est déjà installée/i)).toBeInTheDocument());
  });
});
