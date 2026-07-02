import { RefreshCw } from 'lucide-react';

/**
 * V2.1 TRACK — "already logged today" notice (P3 fix).
 *
 * Rendered by a pillar wizard host page when the member already has a log for
 * the current kind + member-timezone today. Signals that the form is PREFILLED
 * with the existing saisie and that re-submitting updates it rather than
 * silently overwriting an invisible value (pattern carbone the `/review/new`
 * "Reprendre ma revue" banner, PR #463).
 *
 * Server Component (no client interactivity). `:root` blue tokens — the TRACK
 * module rides the app-wide accent, never the REFLECT `.v18-theme` scope.
 */
export function AlreadyLoggedNotice({ pillarLabel }: { pillarLabel: string }) {
  return (
    <section
      aria-label={`${pillarLabel} déjà loggué aujourd'hui`}
      data-slot="already-logged-notice"
      className="rounded-card-lg flex items-start gap-3 border border-[var(--b-acc)] p-4"
      style={{
        background: 'linear-gradient(135deg, var(--acc-dim) 0%, var(--bg-2) 80%)',
      }}
    >
      <RefreshCw
        className="mt-0.5 h-5 w-5 shrink-0 text-[var(--acc)]"
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="space-y-1">
        <p className="t-eyebrow-lg text-[var(--acc)]">Reprendre ta saisie</p>
        <p className="text-[13px] leading-relaxed text-[var(--t-2)]">
          Déjà loggué aujourd&apos;hui : le formulaire reprend tes valeurs, re-soumettre met à jour.
        </p>
      </div>
    </section>
  );
}
