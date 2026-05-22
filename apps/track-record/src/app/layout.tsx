import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

const TITLE = 'Fxmily · Track record';
const DESCRIPTION =
  "Track record public d'Eliott et de la fxmily — résultats de trading transparents, " +
  'exprimés en pourcentages, trades partagés en live avec les membres. Pertes incluses, ' +
  'aucune période exclue. Performances passées ne préjugent pas des performances futures.';

export const metadata: Metadata = {
  title: { default: TITLE, template: '%s · Fxmily Track Record' },
  description: DESCRIPTION,
  applicationName: 'Fxmily Track Record',
  authors: [{ name: 'Eliott', url: 'https://fxmilyapp.com' }],
  generator: 'Next.js',
  keywords: [
    'trading',
    'track record',
    'fxmily',
    'forex',
    'transparence',
    'résultats trading',
    'eliot',
  ],
  // robots.ts owns the crawl policy in T0 (deny all); when shipped (T3) we
  // flip robots.ts to allow + use Next's metadata only to fine-tune (no-archive etc).
  openGraph: {
    type: 'website',
    locale: 'fr_FR',
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'Fxmily Track Record',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0e14' },
    { media: '(prefers-color-scheme: light)', color: '#0b0e14' }, // lock dark
  ],
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // Pas de `maximumScale` ni `userScalable: false` — WCAG 1.4.4 strict.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable} dark`}>
      <body className="min-h-screen bg-[var(--tr-bg)] text-[var(--tr-t-1)] antialiased">
        {/* Skip link (WCAG 2.4.1 Bypass Blocks) — invisible until focus. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-[var(--tr-acc)] focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-[var(--tr-acc-fg)]"
          style={{ boxShadow: 'var(--tr-sh-cta)' }}
        >
          Aller au contenu principal
        </a>
        <div id="main-content" tabIndex={-1} className="outline-none">
          {children}
        </div>
      </body>
    </html>
  );
}
