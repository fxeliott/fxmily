import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { GeistSans } from 'geist/font/sans';
import { CookieBanner } from '@/components/legal/cookie-banner';
import { LegalFooter } from '@/components/legal/legal-footer';
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

export const metadata: Metadata = {
  title: {
    default: 'Fxmily',
    template: '%s — Fxmily',
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
  themeColor: '#07090f',
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${GeistSans.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        {/*
          Skip-link (J10 Phase I — a11y H1 / WCAG 2.4.1 Bypass Blocks). Hidden
          off-screen until focused via Tab from page-load ; clicking it jumps
          straight to the main content, bypassing the global header/footer.
          `tabindex="-1"` on the target lets the link focus a non-interactive
          container without making it tab-stoppable in the regular flow.
        */}
        <a
          href="#main-content"
          className="absolute top-2 left-2 z-50 -translate-y-16 rounded-md bg-[var(--acc)] px-3 py-2 text-[12px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-toast)] transition-transform focus:translate-y-0"
        >
          Aller au contenu principal
        </a>
        <TooltipProvider>
          <div id="main-content" tabIndex={-1} className="flex min-h-full flex-1 flex-col">
            {children}
          </div>
          <LegalFooter />
        </TooltipProvider>
        <CookieBanner />
      </body>
    </html>
  );
}
