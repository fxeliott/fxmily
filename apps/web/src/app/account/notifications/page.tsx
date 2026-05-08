import { ArrowLeft, Bell, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { PreferencesGrid } from '@/components/account/preferences-grid';
import { PushToggle } from '@/components/account/push-toggle';
import { ServiceWorkerRegister } from '@/components/account/sw-register';
import { btnVariants } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { env } from '@/lib/env';
import { getEffectivePreferences } from '@/lib/push/preferences';
import { listSafeSubscriptionsForUser } from '@/lib/push/service';

/**
 * `/account/notifications` — J9 main UI.
 *
 * Server Component. Loads :
 *  - effective preferences (5 NotificationType slugs, default-true if missing).
 *  - active subscription count (NEVER endpoints — endpoint enumeration risk
 *    per SPEC §16).
 *  - VAPID public key from env (passed as prop to `<PushToggle>`).
 *
 * If `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PUBLIC_KEY` is missing, the
 * server renders a "config manquante" state — no client toggle. This way the
 * member never sees a broken Activate button on a fresh deployment.
 *
 * The SW registration is mounted from this page (for V1; J10 may move it to
 * the authenticated layout when we ship more PWA surfaces).
 */

export const metadata = {
  title: 'Notifications · Fxmily',
};
export const dynamic = 'force-dynamic';

export default async function AccountNotificationsPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login?redirect=/account/notifications');
  }
  const userId = session.user.id;
  const isAdmin = session.user.role === 'admin';

  const [preferences, subscriptions] = await Promise.all([
    getEffectivePreferences(userId),
    listSafeSubscriptionsForUser(userId),
  ]);

  // Fall back to the public mirror if it's set, otherwise use the same
  // server-side key — both should match when deployed correctly. Empty string
  // signals "not configured" to the client island, which renders a friendly
  // disabled state.
  const vapidPublicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? env.VAPID_PUBLIC_KEY ?? '';
  const isConfigured = vapidPublicKey.length > 0;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <ServiceWorkerRegister />

      <header className="mb-6">
        <Link
          href="/dashboard"
          className={btnVariants({ kind: 'ghost', size: 'm' })}
          aria-label="Retour au dashboard"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Dashboard
        </Link>
        <h1 className="text-foreground mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Notifications
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Reste informé sur ce qui compte, sans être noyé. Tu choisis ce qui mérite une notification
          — et tu peux tout couper en un clic.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Pill tone="acc">
            <Bell aria-hidden="true" className="h-3 w-3" />
            {subscriptions.length === 0
              ? 'Aucun appareil abonné'
              : subscriptions.length === 1
                ? '1 appareil abonné'
                : `${subscriptions.length} appareils abonnés`}
          </Pill>
        </div>
      </header>

      <section className="mb-8 space-y-3">
        <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
          Activation
        </h2>
        {isConfigured ? (
          <PushToggle
            vapidPublicKey={vapidPublicKey}
            initialSubscriptionCount={subscriptions.length}
          />
        ) : (
          <div className="border-warning/30 bg-card rounded-lg border p-4">
            <div className="text-foreground flex items-center gap-2 text-sm font-medium">
              <ShieldCheck aria-hidden="true" className="text-warning h-4 w-4" />
              Configuration en attente
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              Les notifications push sont en cours de mise en service. Reviens dans quelques minutes
              — ou demande à Eliot si l&apos;attente persiste.
            </p>
          </div>
        )}
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
          Catégories
        </h2>
        <PreferencesGrid initialPreferences={preferences} isAdmin={isAdmin} />
        <p className="text-muted-foreground text-xs">
          Toutes les catégories sont activées par défaut. Bascule un toggle pour suspendre une
          catégorie sans toucher aux autres.
        </p>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
          Comment ça marche
        </h2>
        <div className="border-border bg-card text-muted-foreground space-y-2 rounded-lg border p-4 text-sm">
          <p>
            <strong className="text-foreground">Pas de cloches inutiles.</strong> Fxmily
            n&apos;envoie jamais de promo, jamais de FOMO, jamais d&apos;analyse de marché.
            Uniquement ce qui sert ta discipline.
          </p>
          <p>
            <strong className="text-foreground">Ton choix prime.</strong> Si tu désactives une
            catégorie, le serveur vérifie systématiquement avant d&apos;envoyer — aucun message ne
            te parvient en contradiction avec tes réglages.
          </p>
          <p>
            <strong className="text-foreground">Aucun audio.</strong> Les notifications restent
            visuelles et haptiques (vibration système). Pas de sonneries Fxmily-specific.
          </p>
        </div>
      </section>
    </main>
  );
}
