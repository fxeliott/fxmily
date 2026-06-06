/**
 * §26 Calendrier adaptatif — calm weekly warnings (J-C4).
 *
 * The AI may surface 0-3 short, calm reminders (e.g. "tu as visé 6 sessions
 * mais déclaré peu de disponibilité le soir"). Posture: AMBER (`--warn`),
 * NEVER red, NEVER alarmist — these are gentle nudges, not failures
 * (anti-Black-Hat). Renders NOTHING when there is no warning.
 *
 * Pure Server Component (eyebrow `<p>` label, no heading — the page/panel owns
 * the hierarchy, carbone `monthly-debrief-reader`).
 */
export function CalendarWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;

  return (
    <section
      data-slot="calendar-warnings"
      className="rounded-card-lg border border-l-4 border-[var(--b-default)] border-l-[var(--warn)] bg-[var(--bg-1)] p-5"
    >
      <p className="t-eyebrow-lg text-[var(--warn)]">À garder en tête</p>
      <ul className="mt-2 flex flex-col gap-2">
        {warnings.map((warning, idx) => (
          <li key={`warning-${idx}`} className="t-body flex gap-2 text-[var(--t-2)]">
            <span aria-hidden="true" className="text-[var(--warn)]">
              ·
            </span>
            <span>{warning}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
