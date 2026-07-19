import { ArrowLeft, ChevronRight, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import {
  listReflectionsForAdmin,
  type AdminReflectionEntry,
} from '@/lib/admin/reflections-service';
import { logAudit } from '@/lib/auth/audit';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Réflexions · Admin',
};

export const dynamic = 'force-dynamic';

interface ReflectionsPageProps {
  searchParams: Promise<{ cursor?: string }>;
}

/** Reflection ids are cuids — reject anything else BEFORE it reaches the Prisma
 *  cursor (a forged `?cursor=` must degrade to page 1, never to a 500). Mirror
 *  of `admin/members/page.tsx:parseCursor`. */
function parseCursor(value: string | undefined): string | undefined {
  return value && /^[a-z0-9]{20,40}$/i.test(value) ? value : undefined;
}

/** Build the reflections href carrying an optional cursor. The cursor is a plain
 *  searchParam so the view stays shareable + back-button-friendly (no client
 *  state), exactly like the members list. */
function reflectionsHref(cursor?: string | null): string {
  return cursor ? `/admin/reflections?cursor=${cursor}` : '/admin/reflections';
}

// The `date` column is a calendar day (no time component) — render it in the UTC
// frame so it never shifts a day. `createdAt` is a precise instant → Paris.
const FMT_REFLECT_DATE_LONG_UTC = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const FMT_CREATED_AT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
});

const ABCD_ROWS: ReadonlyArray<{ key: keyof AdminReflectionEntry; letter: string; label: string }> =
  [
    { key: 'triggerEvent', letter: 'A', label: 'Déclencheur' },
    { key: 'beliefAuto', letter: 'B', label: 'Croyance automatique' },
    { key: 'consequence', letter: 'C', label: 'Conséquence' },
    { key: 'disputation', letter: 'D', label: 'Mise en question' },
  ];

export default async function AdminReflectionsPage({ searchParams }: ReflectionsPageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const { cursor: rawCursor } = await searchParams;
  const cursor = parseCursor(rawCursor);

  // Cursor-paginated cross-member feed. A stale cursor (an entry deleted since
  // the link was rendered) returns an empty page (Prisma 7 — no throw), handled
  // by the dead-end below; a genuine DB error must surface, not loop — the net
  // catches ONLY when a cursor is in play (mirror of the members list / trades
  // tab). `redirect` stays outside the catch (Next signals via NEXT_REDIRECT).
  let page: Awaited<ReturnType<typeof listReflectionsForAdmin>> | null = null;
  try {
    page = await listReflectionsForAdmin({ limit: 50, cursor });
  } catch (err) {
    if (!cursor) throw err;
    page = null;
  }
  if (page === null) redirect(reflectionsHref());

  // PII-FREE trace (SPEC §21.6 confidentialité) — metadata carries the page size
  // + the cursor id ONLY, NEVER the reflection text.
  await logAudit({
    action: 'admin.reflections.listed',
    userId: session.user.id,
    metadata: { count: page.items.length, ...(cursor ? { cursor } : {}) },
  });

  const isEmpty = page.items.length === 0;

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-8 lg:px-8">
      {/* S19.2 — ambient mesh for admin-surface coherence (members/reports/system). */}
      <DashboardAmbient />
      <header className="relative flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Tableau de bord
        </Link>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Pill tone="acc">ADMIN</Pill>
            <span className="t-eyebrow">Lecture seule · ton privé</span>
          </div>
          <h1
            className="f-display h-rise text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Réflexions
          </h1>
          <p className="t-body max-w-[52ch] text-[var(--t-3)]">
            Le journal ABCD (Ellis) des membres, du plus récent au plus ancien, tous membres
            confondus. Cette vue est privée : elle n’est jamais partagée par email ni notification.
          </p>
        </div>
      </header>

      {isEmpty ? (
        <Card primary className="py-2">
          <EmptyState
            icon={NotebookPen}
            headline={cursor ? 'Fin de la liste.' : 'Aucune réflexion pour le moment.'}
            lead={
              cursor
                ? 'Tu as atteint le bas du fil des réflexions.'
                : 'Les réflexions ABCD des membres apparaîtront ici dès qu’une première entrée sera écrite.'
            }
            {...(cursor
              ? {
                  ctaPrimary: <>Revenir au début</>,
                  ctaHref: '/admin/reflections',
                }
              : {})}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-3" data-slot="admin-reflections-list">
            {page.items.map((entry) => (
              <li key={entry.id}>
                <Card className="flex flex-col gap-3 p-4">
                  <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <Link
                      href={`/admin/members/${entry.memberId}?tab=reflections`}
                      className="group inline-flex items-center gap-1 text-[var(--t-1)] transition-colors hover:text-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
                    >
                      <span className="t-eyebrow-lg">{entry.memberDisplayName}</span>
                      <ChevronRight
                        className="h-3.5 w-3.5 text-[var(--t-3)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--acc)]"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                    </Link>
                    <p className="t-cap text-[var(--t-2)]">
                      <time dateTime={entry.date}>
                        {FMT_REFLECT_DATE_LONG_UTC.format(new Date(`${entry.date}T00:00:00Z`))}
                      </time>
                      <span className="t-cap ml-2 font-mono text-[var(--t-3)]">
                        {FMT_CREATED_AT.format(new Date(entry.createdAt))}
                      </span>
                    </p>
                  </header>

                  <dl className="flex flex-col gap-2.5">
                    {ABCD_ROWS.map((row) => (
                      <div key={row.letter} className="flex items-baseline gap-3">
                        <dt className="flex shrink-0 items-baseline gap-1.5">
                          <span
                            aria-hidden
                            className="grid h-6 w-6 place-items-center rounded-full border border-[var(--b-default)] bg-[var(--bg-2)] font-mono text-[11px] font-semibold text-[var(--t-2)]"
                          >
                            {row.letter}
                          </span>
                          <span className="sr-only">{row.label}</span>
                        </dt>
                        <dd className="t-body break-words whitespace-pre-wrap text-[var(--t-1)]">
                          {entry[row.key]}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              </li>
            ))}
          </ul>

          {/* Pagination — cursor through the cross-member feed (newest → oldest). */}
          <footer className="flex flex-col items-center gap-3 border-t border-[var(--b-subtle)] pt-2">
            {page.nextCursor ? (
              <Link
                href={reflectionsHref(page.nextCursor)}
                prefetch={false}
                className={cn(btnVariants({ kind: 'ghost', size: 'm' }))}
              >
                Voir les réflexions plus anciennes
              </Link>
            ) : null}
            <p className="t-foot text-center text-[var(--t-4)]">
              Affichage de {page.items.length} réflexion{page.items.length > 1 ? 's' : ''}
              {cursor ? (
                <>
                  {' · '}
                  <Link href="/admin/reflections" className="underline hover:text-[var(--t-2)]">
                    revenir au début
                  </Link>
                </>
              ) : null}
            </p>
          </footer>
        </div>
      )}
    </main>
  );
}
