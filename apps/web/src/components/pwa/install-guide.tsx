'use client';

import { Check, Download, Plus, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { detectPlatform, isStandalone, type Platform } from '@/lib/pwa/platform';

/**
 * `<InstallGuide>` — platform-adapted "Add to Home Screen" instructions.
 *
 * Renders on `/install`. It detects the platform on the client and shows the
 * relevant flow:
 * - **iOS Safari** → the manual Share-sheet flow (Partager → "Sur l'écran
 *   d'accueil" → "Ajouter") as illustrated, numbered steps. iOS never fires
 *   `beforeinstallprompt`, so this is the only path available there.
 * - **Android / desktop (Chromium)** → a one-tap install button when the browser
 *   has offered `beforeinstallprompt`, otherwise browser-menu instructions.
 * - **Already installed / standalone** → a calm confirmation, nothing to do.
 *
 * Hydration-safe: the first render (SSR + first client paint) is
 * platform-agnostic (a neutral "detecting your device" placeholder) via a
 * `useSyncExternalStore` client gate, so there is never a server/client HTML
 * mismatch. Platform-specific content appears only after mount.
 *
 * Copy is calm and process-focused (Mark Douglas posture). Any illustration uses
 * anonymized DEMO content — never a real member's data.
 */

/** Chromium's non-standard install-prompt event (not in the DOM lib types). */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

const emptySubscribe = () => () => {};

/**
 * Returns `false` during SSR and the first client render, then `true` after
 * mount. Mirrors the repo's `useSyncExternalStore` discipline so the first
 * client paint matches the server markup (no hydration mismatch, no
 * `set-state-in-effect` lint).
 */
function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/** iOS "Share" glyph — inline because this build of lucide-react does not export it. */
function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M12 3v11M12 3 8.5 6.5M12 3l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 10.5H5.5A1.5 1.5 0 0 0 4 12v7A1.5 1.5 0 0 0 5.5 20.5h13A1.5 1.5 0 0 0 20 19v-7a1.5 1.5 0 0 0-1.5-1.5H18"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Android overflow (kebab) glyph — inline because this build of lucide-react does not export it. */
function KebabGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

function StepIconBadge({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
    >
      {children}
    </span>
  );
}

/** One numbered instruction row. The visible number badge is `aria-hidden` — the
 * enclosing `<ol>` already announces the position to screen readers. */
function Step({
  n,
  icon,
  title,
  detail,
}: {
  n: number;
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--bg-2)] text-[12px] font-semibold text-[var(--t-2)] tabular-nums"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <StepIconBadge>{icon}</StepIconBadge>
        <div className="min-w-0 pt-0.5">
          <p className="t-body text-[var(--t-1)]">{title}</p>
          {detail ? <p className="t-cap mt-0.5 text-[var(--t-3)]">{detail}</p> : null}
        </div>
      </div>
    </li>
  );
}

/** Anonymized DEMO illustration of the iOS "Add to Home Screen" row. Purely
 * decorative (`aria-hidden`) — the numbered steps carry the actual instructions.
 * Uses a fictional app tile, never a real member. */
function IosDemoPreview() {
  return (
    <figure className="mt-1">
      <div
        aria-hidden="true"
        className="rounded-card-lg flex items-center justify-between gap-3 border border-[var(--b-default)] bg-[var(--bg-2)] px-4 py-3"
      >
        <span className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--acc)] text-[15px] font-bold text-[var(--acc-fg)]">
            f
          </span>
          <span className="flex flex-col">
            <span className="text-[13px] font-medium text-[var(--t-1)]">Fxmily</span>
            <span className="text-[11px] text-[var(--t-3)]">Sur l&apos;écran d&apos;accueil</span>
          </span>
        </span>
        <span className="grid h-6 w-6 place-items-center rounded-[6px] border border-[var(--b-default)] text-[var(--t-2)]">
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      </div>
      <figcaption className="t-cap mt-1.5 text-[var(--t-4)]">
        Aperçu : données de démonstration.
      </figcaption>
    </figure>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="t-h3 text-[var(--t-1)]">{children}</h2>;
}

function IosSteps() {
  return (
    <Card glass className="p-5 sm:p-6">
      <SectionHeading>Sur iPhone ou iPad (Safari)</SectionHeading>
      <p className="t-body mt-1.5 text-[var(--t-2)]">
        Trois gestes, une fois. Ensuite Fxmily s&apos;ouvre en plein écran depuis ton écran
        d&apos;accueil, comme une vraie application.
      </p>
      <ol className="mt-5 flex flex-col gap-5">
        <Step
          n={1}
          icon={<ShareGlyph />}
          title={
            <>
              Touche le bouton <span className="font-medium text-[var(--acc-hi)]">Partager</span>
            </>
          }
          detail="La barre du bas dans Safari (l'icône carrée avec une flèche vers le haut)."
        />
        <Step
          n={2}
          icon={<Plus className="h-4 w-4" strokeWidth={2} />}
          title={
            <>
              Choisis{' '}
              <span className="font-medium text-[var(--acc-hi)]">
                « Sur l&apos;écran d&apos;accueil »
              </span>
            </>
          }
          detail="Fais défiler la liste si tu ne la vois pas tout de suite."
        />
        <Step
          n={3}
          icon={<Check className="h-4 w-4" strokeWidth={2} />}
          title={
            <>
              Touche <span className="font-medium text-[var(--acc-hi)]">« Ajouter »</span> en haut à
              droite
            </>
          }
          detail="L'icône Fxmily apparaît sur ton écran d'accueil."
        />
      </ol>
      <IosDemoPreview />
    </Card>
  );
}

function ChromiumSteps({
  deferredPrompt,
  onInstall,
  installing,
}: {
  deferredPrompt: BeforeInstallPromptEvent | null;
  onInstall: () => void;
  installing: boolean;
}) {
  const isAndroid = detectPlatform(navigator.userAgent, navigator.maxTouchPoints) === 'android';
  return (
    <Card glass className="p-5 sm:p-6">
      <SectionHeading>{isAndroid ? 'Sur Android' : 'Sur ordinateur'}</SectionHeading>
      {deferredPrompt ? (
        <>
          <p className="t-body mt-1.5 text-[var(--t-2)]">
            Ton navigateur peut installer Fxmily en un geste.
          </p>
          <div className="mt-5">
            <Btn kind="primary" size="l" onClick={onInstall} loading={installing}>
              <Download className="h-4 w-4" strokeWidth={2} />
              Installer l&apos;application
            </Btn>
          </div>
          <p className="t-cap mt-3 text-[var(--t-3)]">
            Une fenêtre de confirmation s&apos;ouvre. Confirme, et c&apos;est fait.
          </p>
        </>
      ) : (
        <>
          <p className="t-body mt-1.5 text-[var(--t-2)]">
            Depuis le menu de ton navigateur, ajoute Fxmily à ton appareil.
          </p>
          <ol className="mt-5 flex flex-col gap-5">
            <Step
              n={1}
              icon={<KebabGlyph />}
              title="Ouvre le menu du navigateur"
              detail={
                isAndroid
                  ? 'Les trois points (⋮) en haut à droite.'
                  : "L'icône du menu ou des trois points, à droite de la barre d'adresse."
              }
            />
            <Step
              n={2}
              icon={<Download className="h-4 w-4" strokeWidth={2} />}
              title={
                isAndroid ? (
                  <>
                    Choisis{' '}
                    <span className="font-medium text-[var(--acc-hi)]">
                      « Installer l&apos;application »
                    </span>{' '}
                    ou « Ajouter à l&apos;écran d&apos;accueil »
                  </>
                ) : (
                  <>
                    Choisis{' '}
                    <span className="font-medium text-[var(--acc-hi)]">« Installer Fxmily »</span>
                  </>
                )
              }
            />
            <Step
              n={3}
              icon={<Check className="h-4 w-4" strokeWidth={2} />}
              title="Confirme"
              detail="Fxmily s'ouvre alors dans sa propre fenêtre, sans la barre du navigateur."
            />
          </ol>
        </>
      )}
    </Card>
  );
}

function AlreadyInstalled() {
  return (
    <Card glass className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
        >
          <Check className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <SectionHeading>Fxmily est déjà installée</SectionHeading>
          <p className="t-body mt-1.5 text-[var(--t-2)]">
            Tu utilises l&apos;application installée. Rien à faire, retrouve-la sur ton écran
            d&apos;accueil quand tu en as besoin.
          </p>
        </div>
      </div>
    </Card>
  );
}

function DetectingPlaceholder() {
  return (
    <Card glass className="p-5 sm:p-6">
      <p className="t-body text-[var(--t-3)]">Détection de ton appareil…</p>
    </Card>
  );
}

export function InstallGuide() {
  const isClient = useIsClient();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    const prompt = deferredPrompt;
    if (!prompt) return;
    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
    } catch {
      // A rejected/failed prompt leaves the manual instructions available.
    } finally {
      setDeferredPrompt(null);
      setInstalling(false);
    }
  }, [deferredPrompt]);

  let platform: Platform | null = null;
  let standalone = false;
  if (isClient) {
    platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
    standalone = isStandalone();
  }

  return (
    <section
      role="region"
      aria-label="Installer l'application Fxmily"
      data-slot="install-guide"
      className="flex flex-col gap-6"
    >
      <header className="flex flex-col gap-2">
        <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--acc-hi)]">
          <Smartphone className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          Installation
        </span>
        <h1 className="t-h2 text-[var(--t-1)]">Installe Fxmily sur ton écran d&apos;accueil</h1>
        <p className="t-lead max-w-[60ch] text-[var(--t-2)]">
          Un accès direct, en plein écran, sans passer par le navigateur. C&apos;est le même Fxmily,
          juste plus rapide à ouvrir au quotidien.
        </p>
      </header>

      {!isClient ? (
        <DetectingPlaceholder />
      ) : installed || standalone ? (
        <AlreadyInstalled />
      ) : platform === 'ios' ? (
        <IosSteps />
      ) : (
        <ChromiumSteps
          deferredPrompt={deferredPrompt}
          onInstall={handleInstall}
          installing={installing}
        />
      )}
    </section>
  );
}
