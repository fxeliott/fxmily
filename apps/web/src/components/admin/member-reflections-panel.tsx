import { NotebookPen } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { SerializedReflectionEntry } from '@/lib/reflection/service';

/**
 * J6-admin-scale item 4 — admin READ-ONLY reflections section for the member
 * detail `?tab=reflections`. Carbon of `MemberMindsetChecksPanel` : action-free
 * by construction (NO form, NO mutation — lecture seule, ton privé). The member
 * never sees this admin view; the ABCD text is surfaced verbatim so the admin
 * can read the member's CBT journal, but it lives only under `/admin/*` and is
 * never emailed / notified / audited (the audit metadata carries ids + counts).
 *
 * DS-v2 NEUTRAL — no `--cy*` (training) and no `.v18-theme` (the member REFLECT
 * blue theme); the letters read on the app-wide neutral tokens like the rest of
 * the admin surface.
 */

// Civil-date pin rendered in the UTC frame (the `date` column is a calendar day,
// no time component) — carbon of the /reflect landing formatter.
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

const ABCD_ROWS: ReadonlyArray<{
  key: keyof SerializedReflectionEntry;
  letter: string;
  label: string;
}> = [
  { key: 'triggerEvent', letter: 'A', label: 'Déclencheur' },
  { key: 'beliefAuto', letter: 'B', label: 'Croyance automatique' },
  { key: 'consequence', letter: 'C', label: 'Conséquence' },
  { key: 'disputation', letter: 'D', label: 'Mise en question' },
];

export function MemberReflectionsPanel({ entries }: { entries: SerializedReflectionEntry[] }) {
  if (entries.length === 0) {
    return (
      <Card primary className="py-2">
        <EmptyState
          icon={NotebookPen}
          headline="Aucune réflexion pour ce membre."
          lead="Les réflexions ABCD apparaîtront ici dès qu'il aura écrit sa première entrée."
        />
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-slot="member-reflections">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="t-h2 text-[var(--t-1)]">Réflexions ABCD</h2>
        <p className="t-cap text-[var(--t-3)]">
          {entries.length} affichée{entries.length > 1 ? 's' : ''}
        </p>
      </div>

      <ul className="flex flex-col gap-3" data-slot="member-reflections-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Card className="flex flex-col gap-3 p-4">
              <header className="flex items-baseline justify-between gap-3">
                <p className="t-eyebrow-lg text-[var(--t-2)]">
                  <time dateTime={entry.date}>
                    {FMT_REFLECT_DATE_LONG_UTC.format(new Date(`${entry.date}T00:00:00Z`))}
                  </time>
                </p>
                <p className="t-cap font-mono text-[var(--t-3)]">
                  {FMT_CREATED_AT.format(new Date(entry.createdAt))}
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
    </section>
  );
}
