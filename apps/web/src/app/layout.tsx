import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import localFont from 'next/font/local';
import { GeistSans } from 'geist/font/sans';
import { Suspense } from 'react';
import { auth, signOut } from '@/auth';
import { MicroObjectivePillSlot } from '@/components/coaching/micro-objective-pill';
import { CookieBanner } from '@/components/legal/cookie-banner';
import { LegalFooter } from '@/components/legal/legal-footer';
import { MotionProvider } from '@/components/motion-provider';
import { RouteFocusAnnouncer } from '@/components/route-focus-announcer';
import { ThemeProvider } from '@/components/theme-provider';
import { AppShell } from '@/components/nav/app-shell';
import { LogExpressFab } from '@/components/track/log-express-fab';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
});

// Signature typographique : Clash Display (Indian Type Foundry, licence ITF FFL
// — cf. src/fonts/ClashDisplay-LICENSE-FFL.txt). Fichiers woff2 officiels
// Fontshare utilisés tels quels (la licence interdit la conversion de format).
// Deux graisses seulement (Semibold 600 + Bold 700) : la face display ne sert
// qu'aux titres/hero/KPI, le corps de texte reste sur Inter/Geist.
// `adjustFontFallback` calibre la métrique du fallback système pour tuer le CLS
// pendant le swap ; `--font-display-face` est la variable consommée par
// `--font-display` dans globals.css.
const clashDisplay = localFont({
  variable: '--font-display-face',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
  src: [
    {
      path: '../fonts/ClashDisplay-Semibold.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../fonts/ClashDisplay-Bold.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
});

export const metadata: Metadata = {
  title: {
    default: 'Fxmily',
    template: '%s · Fxmily',
  },
  description:
    'Suivi comportemental des membres de la formation de trading Fxmily : journal, check-ins, scoring, coaching.',
  applicationName: 'Fxmily',
  authors: [{ name: 'Fxmily' }],
  generator: 'Next.js',
  referrer: 'origin-when-cross-origin',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/logo.png', type: 'image/png' },
    ],
    apple: '/logo.png',
  },
  manifest: '/manifest.webmanifest',
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  // Light + dark : la couleur de chrome UA/PWA suit la préférence OS (le thème
  // in-app est piloté par le toggle next-themes, dark par défaut).
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#07090f' },
    { media: '(prefers-color-scheme: light)', color: '#f1f3f7' },
  ],
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark light',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Session lue UNE fois ici pour piloter l'AppShell (nav globale). L'appel à
  // auth() rend le layout dynamique — acceptable pour une app privée (cohorte
  // fermée, robots noindex). L'AppShell se retire de lui-même sur les routes
  // publiques / hors session (il rend alors uniquement `children`).
  const session = await auth();
  const sessionLite = session?.user
    ? {
        name: session.user.name?.trim() || session.user.email?.split('@')[0] || 'Membre',
        email: session.user.email ?? '',
        isAdmin: session.user.role === 'admin',
      }
    : null;

  async function handleSignOut() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <html
      lang="fr"
      // next-themes écrit la classe .dark/.light côté client avant le paint →
      // le SSR (sans classe) diffère : suppressHydrationWarning est obligatoire.
      suppressHydrationWarning
      className={`${GeistSans.variable} ${inter.variable} ${jetbrainsMono.variable} ${clashDisplay.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        <ThemeProvider>
          {/*
          Skip-link (J10 Phase I — a11y H1 / WCAG 2.4.1 Bypass Blocks). Hidden
          off-screen until focused via Tab from page-load ; clicking it jumps
          straight to the main content, bypassing the global header/footer.
          `tabindex="-1"` on the target lets the link focus a non-interactive
          container without making it tab-stoppable in the regular flow.
        */}
          <a
            href="#main-content"
            className="absolute top-2 left-2 z-50 -translate-y-16 rounded-md bg-[var(--acc-btn)] px-3 py-2 text-[12px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-toast)] transition-transform focus:translate-y-0"
          >
            Aller au contenu principal
          </a>
          {/*
          App-wide ambient backplate (§245 "prend tout l'écran, jamais coincé
          au milieu"). A single fixed `z-index:-1` deep-space mesh painted behind
          ALL content so no route ever shows a flat letterbox gutter on large /
          ultra-wide screens. Pages that own an opaque-bg `<main>` + a hero
          ambient (dashboard, library, login, reflect…) fully cover it → no
          double aurora; transparent-`<main>` pages (forms, journal, admin)
          reveal it through their gutters. Full rationale: `.app-ambient` in
          globals.css. Decorative → aria-hidden, pointer-events:none.
        */}
          <div className="app-ambient" aria-hidden="true" />
          <TooltipProvider>
            <MotionProvider>
              <AppShell
                session={sessionLite}
                signOutAction={handleSignOut}
                // Tour 10 — micro-objectif ouvert épinglé dans le chrome (membres
                // uniquement : l'admin n'a pas de boucle de coaching). Suspense
                // fallback null : le shell flush sans attendre la requête ; la
                // requête est React.cache()-ée avec /dashboard et /objectifs.
                pill={
                  session?.user?.id && session.user.role !== 'admin' ? (
                    <Suspense fallback={null}>
                      <MicroObjectivePillSlot userId={session.user.id} />
                    </Suspense>
                  ) : null
                }
              >
                <div id="main-content" tabIndex={-1} className="flex min-h-full flex-1 flex-col">
                  {/* S15 #23 — SPA focus reset + sr-only route announcement. Mounted
                    here (persists across navigations) so usePathname changes are
                    observed without remounting. */}
                  <RouteFocusAnnouncer />
                  {children}
                </div>
              </AppShell>
            </MotionProvider>
            <LogExpressFab />
            <LegalFooter />
          </TooltipProvider>
          <CookieBanner />
        </ThemeProvider>
      </body>
    </html>
  );
}
