/**
 * P3 — calm "Reprendre mon check-in" banner shown when the member re-opens a
 * slot he ALREADY submitted (edit mode). Mirrors the `/review/new` resume
 * notice (#463): it makes explicit that the wizard is seeded with the existing
 * answers and that re-submitting UPDATES them, so the service upsert stops being
 * a silent, invisible overwrite.
 *
 * Pure presentational Server Component (no client hooks) — safe to render from
 * the slot host pages.
 */

interface CheckinResumeNoticeProps {
  slot: 'morning' | 'evening';
}

export function CheckinResumeNotice({ slot }: CheckinResumeNoticeProps) {
  const word = slot === 'morning' ? 'du matin' : 'du soir';
  return (
    <section
      aria-label={`Check-in ${word} déjà enregistré`}
      data-slot="checkin-resume-notice"
      className="rounded-card-lg border border-[var(--b-acc)] p-4"
      style={{
        background: 'linear-gradient(135deg, var(--acc-dim) 0%, var(--bg-2) 80%)',
      }}
    >
      <p className="t-eyebrow text-[var(--t-3)]">Reprendre mon check-in</p>
      <p className="t-body mt-1 text-[var(--t-1)]">
        Tu as déjà un check-in {word} pour ce jour : tes réponses sont pré-remplies. Le soumettre à
        nouveau le met à jour.
      </p>
    </section>
  );
}
