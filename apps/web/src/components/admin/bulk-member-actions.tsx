'use client';

import { ListChecks, StickyNote, Users, X } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { bulkAddMemberNoteAction } from '@/app/admin/members/bulk-actions';
import { btnVariants } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { cn } from '@/lib/utils';

/**
 * `<BulkMemberActions>` — J6 scope 7 (bulk v1) admin island.
 *
 * Lets the coach select several members ON THE CURRENT PAGE and apply one mass
 * action: add the same private coaching note to all of them (SPEC §7.7 — never
 * member-facing). Pair it with the page's `?attention=1` filter + search to
 * scope the page to a cohort subset, then "select all on this page".
 *
 * The panel is collapsed by default (opt-in) so the read-first directory stays
 * calm. Display truth stays server-side: after a successful batch we
 * `router.refresh()` so the new notes are reflected. No optimistic member state.
 */

const MAX_BODY = 2000;

export type BulkMember = { id: string; name: string; email: string };

export function BulkMemberActions({ members }: { members: BulkMember[] }): React.ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  const allIds = useMemo(() => members.map((m) => m.id), [members]);
  const allSelected = selected.size > 0 && selected.size === members.length;
  const bodyTrimmed = body.trim();
  const canSubmit = selected.size > 0 && bodyTrimmed.length > 0 && !pending;

  function toggle(id: string): void {
    setResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setResult(null);
    setSelected((prev) => (prev.size === members.length ? new Set() : new Set(allIds)));
  }

  function handleSubmit(): void {
    if (!canSubmit) return;
    setResult(null);
    const ids = [...selected];
    // AWAIT inside the transition so `pending` stays true for the whole
    // round-trip (React 19 async Actions) — without the await, `pending` flips
    // back synchronously, the `!pending` guard in `canSubmit` is inert, the
    // button never disables, and a double-click writes duplicate AdminNote rows.
    // The try/catch turns a REJECTION (e.g. the whitelist read throwing outside
    // the action's per-note try/catch) into the same error UI instead of an
    // unhandled rejection that silently shows the admin nothing.
    startTransition(async () => {
      try {
        const res = await bulkAddMemberNoteAction(ids, bodyTrimmed);
        if (!res.ok) {
          const message =
            res.error === 'unauthorized' || res.error === 'forbidden'
              ? 'Action réservée à l’admin.'
              : res.error === 'invalid_input'
                ? 'Sélection ou note invalide.'
                : 'Échec de l’enregistrement, réessaie.';
          setResult({ kind: 'error', message });
          return;
        }
        const n = res.created ?? 0;
        setResult({
          kind: 'ok',
          message: `Note ajoutée à ${n} membre${n > 1 ? 's' : ''}.`,
        });
        setSelected(new Set());
        setBody('');
        router.refresh();
      } catch {
        setResult({ kind: 'error', message: 'Échec de l’enregistrement, réessaie.' });
      }
    });
  }

  if (members.length === 0) return null;

  return (
    <section
      aria-label="Actions groupées sur les membres"
      className="rounded-card border border-[var(--b-default)] bg-[var(--bg-1)] shadow-[var(--sh-card)]"
    >
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--bg-3)] text-[var(--acc-hi)] ring-1 ring-[var(--b-acc)] ring-inset"
          >
            <ListChecks className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-[var(--t-1)]">Actions groupées</p>
            <p className="t-cap text-[var(--t-3)]">
              Ajoute une note privée à plusieurs membres d’un coup.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(btnVariants({ kind: open ? 'ghost' : 'secondary', size: 's' }))}
        >
          {open ? (
            <>
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              Fermer
            </>
          ) : (
            <>
              <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
              Sélection multiple
            </>
          )}
        </button>
      </div>

      {open ? (
        <div className="border-t border-[var(--b-subtle)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--t-2)]">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 accent-[var(--acc)]"
              />
              Tout sélectionner sur cette page
            </label>
            {selected.size > 0 ? (
              <Pill tone="acc">
                {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
              </Pill>
            ) : null}
          </div>

          <ul className="rounded-card max-h-56 divide-y divide-[var(--b-subtle)] overflow-y-auto border border-[var(--b-subtle)]">
            {members.map((m) => {
              const id = `bulk-${m.id}`;
              const checked = selected.has(m.id);
              return (
                <li key={m.id}>
                  <label
                    htmlFor={id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--bg-2)]"
                  >
                    <input
                      id={id}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(m.id)}
                      className="h-4 w-4 accent-[var(--acc)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[var(--t-1)]">{m.name}</span>
                      <span className="block truncate text-[11px] text-[var(--t-3)]">
                        {m.email}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-3">
            <label
              htmlFor="bulk-note-body"
              className="mb-1 block text-sm font-medium text-[var(--t-2)]"
            >
              Note privée à ajouter
            </label>
            <textarea
              id="bulk-note-body"
              value={body}
              onChange={(e) => {
                setResult(null);
                setBody(e.target.value);
              }}
              maxLength={MAX_BODY}
              rows={3}
              placeholder="Ex : relancer sur la règle de hedge avant la session New York."
              className="rounded-card w-full resize-y border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2 font-sans text-[14px] text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="t-cap text-[var(--t-4)] tabular-nums">
                {bodyTrimmed.length}/{MAX_BODY}
              </span>
              <span className="t-cap text-[var(--t-3)]">Jamais visible par le membre (§7.7).</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(btnVariants({ kind: 'primary', size: 'm' }))}
            >
              <StickyNote className="h-4 w-4" strokeWidth={1.75} />
              {pending
                ? 'Enregistrement…'
                : selected.size > 0
                  ? `Ajouter la note à ${selected.size} membre${selected.size > 1 ? 's' : ''}`
                  : 'Ajouter la note'}
            </button>
            {result ? (
              <p
                role={result.kind === 'error' ? 'alert' : 'status'}
                className={cn(
                  'text-sm',
                  result.kind === 'error' ? 'text-[var(--bad)]' : 'text-[var(--ok)]',
                )}
              >
                {result.message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
