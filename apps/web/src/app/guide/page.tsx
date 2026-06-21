import {
  ArrowLeft,
  BookOpen,
  Brain,
  CalendarRange,
  Compass,
  LineChart,
  NotebookPen,
  ScanSearch,
  Sunrise,
  UserCircle,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';

import { auth } from '@/auth';
import { DisciplineLoop } from '@/components/illustrations/discipline-loop';
import { Card } from '@/components/ui/card';
import { btnVariants } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Guide d’utilisation',
  description: 'Comment utiliser Fxmily, pilier par pilier.',
};

/**
 * /guide — "guide d'utilisation clair expliquant comment utiliser l'app"
 * (Session 2 §26 : confort & guidage total, dès le début ET en permanence).
 *
 * Page server-only, member-gated (mirror `app/profile/page.tsx`). Surfacée au
 * premier démarrage par `FirstRunWelcome` et accessible en permanence via la
 * nav (groupe « Compte »). Explique l'app PILIER PAR PILIER — pas seulement les
 * deux premiers gestes — pour que le membre ne soit jamais perdu malgré la
 * densité.
 *
 * Posture §2 (Mark Douglas, non-toxique) : on décrit ce que l'app MESURE et
 * comment s'en servir comme d'un miroir ; AUCUN conseil d'analyse de marché,
 * aucune gamification culpabilisante. Accent bleu de marque uniquement.
 */

interface Pillar {
  icon: typeof BookOpen;
  eyebrow: string;
  title: string;
  body: string;
  points: readonly string[];
  cta?: { href: string; label: string; icon: typeof BookOpen };
}

const PILLARS: readonly Pillar[] = [
  {
    icon: Sunrise,
    eyebrow: 'Au quotidien',
    title: 'Tes gestes du jour',
    body: "Chaque journée s'ouvre par un check-in (ton état, ton sommeil, ta routine du matin) et se referme par un bilan du soir. Entre les deux, tu logges tes trades : ton plan, ton intention, tes émotions avant, pendant et après, et si tu as respecté ton process.",
    points: [
      'Check-in matin : sommeil, routine, état d’esprit avant le marché.',
      'Journal de trade : plan, conviction, émotions, respect du plan et oublis.',
      'Bilan du soir : ce que tu as fait, ta formation suivie, ton travail sur toi.',
    ],
    cta: { href: '/checkin/morning', label: 'Faire mon check-in', icon: Sunrise },
  },
  {
    icon: Brain,
    eyebrow: 'Mental & vérité',
    title: 'Ton mental, sans complaisance',
    body: "Des QCM et tests récurrents font le point sur ta psychologie de trader, à la manière de Mark Douglas. L'app confronte ensuite ce que tu déclares à ce que tu fais réellement — pas pour te juger, mais pour te montrer où l'écart se creuse.",
    points: [
      'QCM mindset réguliers : où tu en es, sur quoi travailler.',
      'Vérité : tes déclarations confrontées à ta réalité d’exécution.',
      'Un coaching psychologique, jamais un conseil sur tes analyses de marché.',
    ],
    cta: { href: '/mindset', label: 'Ouvrir mon mental', icon: Brain },
  },
  {
    icon: LineChart,
    eyebrow: 'Ma progression',
    title: 'Où tu en es, où tu vas',
    body: "Au fil de tes données, l'app dresse tes scores, tes patterns et ton évolution. Tu vois ce qui se solidifie et ce qui demande encore du travail, et tu peux te fixer des objectifs de process (pas des promesses de gains).",
    points: [
      'Tes scores de discipline, d’engagement et de stabilité émotionnelle.',
      'Tes patterns : ce qui revient dans ton trading, en bien comme en mal.',
      'Tes objectifs et ta trajectoire dans le temps.',
    ],
    cta: { href: '/progression', label: 'Voir ma progression', icon: LineChart },
  },
  {
    icon: ScanSearch,
    eyebrow: 'Suivi & orga',
    title: 'Ta présence et ton organisation',
    body: "L'app suit aussi ton assiduité : ta présence aux réunions, ton entraînement, ton analyse de marché déclarée. Tout ce qui construit la régularité d'un athlète de haut niveau.",
    points: [
      'Réunions : ta présence aux créneaux.',
      'Entraînement : tes sessions de travail hors réel.',
      'Analyse de marché : déclarée, jamais évaluée sur le fond.',
    ],
    cta: { href: '/reunions', label: 'Voir mes réunions', icon: CalendarRange },
  },
  {
    icon: UserCircle,
    eyebrow: 'Ton profil',
    title: 'Le portrait qui te ressemble',
    body: "Au tout début, un entretien d'onboarding (une trentaine de questions) permet à l'IA locale de dresser ton profil psychologique et tes axes prioritaires. C'est ton point de départ — il s'affine à mesure que tu nourris l'app.",
    points: [
      'Un entretien guidé, à ton rythme, confidentiel.',
      'Un profil descriptif : tes traits, tes axes de travail.',
      'Eliott, l’admin, te suit derrière pour t’accompagner au plus juste.',
    ],
    cta: { href: '/profile', label: 'Voir mon profil', icon: UserCircle },
  },
];

export default async function GuidePage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-8 lg:px-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Tableau de bord
        </Link>

        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <BookOpen className="h-3.5 w-3.5" strokeWidth={2} />
            Guide d’utilisation
          </span>
          <h1 className="t-h1 text-[var(--t-1)]">Comment utiliser Fxmily.</h1>
        </div>
      </header>

      {/* Le principe — ce que l'app est, et n'est pas (posture §2). */}
      <Card primary glass className="rounded-card-lg p-6 sm:p-7">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--acc)]"
            >
              <Compass className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="t-eyebrow text-[var(--acc-hi)]">Le principe</span>
              <h2 className="t-h2 text-[var(--t-1)]">Un miroir, jamais un juge.</h2>
            </div>
          </div>
          <p className="t-body text-[var(--t-2)]">
            Fxmily mesure <strong className="font-semibold text-[var(--t-1)]">ton plan</strong>, ta{' '}
            <strong className="font-semibold text-[var(--t-1)]">discipline</strong> et ton{' '}
            <strong className="font-semibold text-[var(--t-1)]">mental</strong> — pas les bougies du
            marché. L’app ne te dira jamais quoi trader : elle t’aide à mieux exécuter, à tenir ton
            plan et à travailler ta psychologie. Tu nourris l’app un peu chaque jour, et elle
            t’accompagne dans le temps — rien à entasser d’un coup, juste une pratique régulière que
            tu construis.
          </p>
        </div>
      </Card>

      {/* La boucle — schéma pédagogique du process répétable (Mark Douglas §2). */}
      <Card glass className="rounded-card-lg p-6 sm:p-7">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-0.5">
            <span className="t-eyebrow text-[var(--acc-hi)]">La boucle</span>
            <h2 className="t-h2 text-[var(--t-1)]">Un cycle, pas une prédiction.</h2>
            <p className="t-body mt-2 text-[var(--t-2)]">
              Tout l’app tient dans une routine qui se répète chaque jour. Pas besoin de deviner le
              marché : il suffit de boucler ce cycle, encore et encore. C’est la régularité qui
              construit ton edge.
            </p>
          </div>
          <DisciplineLoop className="pt-1" />
        </div>
      </Card>

      {/* Les piliers, un par un. */}
      <section className="grid gap-4 sm:grid-cols-2" aria-label="Les piliers de l’app">
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <Card key={pillar.title} className="rounded-card-lg h-full p-6">
              <div className="flex h-full flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]"
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="t-eyebrow text-[var(--t-3)]">{pillar.eyebrow}</span>
                    <h2 className="t-h3 text-[var(--t-1)]">{pillar.title}</h2>
                  </div>
                </div>

                <p className="t-body text-[var(--t-2)]">{pillar.body}</p>

                <ul className="flex flex-col gap-2">
                  {pillar.points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--acc)]"
                      />
                      <span className="t-cap text-[var(--t-3)]">{point}</span>
                    </li>
                  ))}
                </ul>

                {pillar.cta ? (
                  <div className="mt-auto pt-1">
                    <Link
                      href={pillar.cta.href}
                      className={cn(btnVariants({ kind: 'secondary', size: 's' }))}
                    >
                      <pillar.cta.icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                      {pillar.cta.label}
                    </Link>
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </section>

      {/* Premier pas. */}
      <Card primary glass className="rounded-card-lg p-6 sm:p-7">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="t-eyebrow text-[var(--acc-hi)]">Et maintenant</span>
            <h2 className="t-h2 text-[var(--t-1)]">Commence par un seul geste.</h2>
          </div>
          <p className="t-body text-[var(--t-2)]">
            Pas besoin de tout faire aujourd’hui. Pose ta routine du matin, ou logge ton premier
            trade. Le reste viendra, à ton rythme.
          </p>
          <div
            className="flex flex-wrap items-center gap-2"
            style={{ '--rise-delay': '0ms' } as CSSProperties}
          >
            <Link
              href="/checkin/morning"
              className={cn(btnVariants({ kind: 'primary', size: 'm' }))}
            >
              <Sunrise className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              Commencer mon check-in
            </Link>
            <Link href="/journal/new" className={cn(btnVariants({ kind: 'secondary', size: 'm' }))}>
              <NotebookPen className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              Logger un trade
            </Link>
          </div>
        </div>
      </Card>
    </main>
  );
}
