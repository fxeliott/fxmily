/**
 * Marqueur visuel de la rupture historique → live (refonte 2026-05-21).
 * Visuellement irréprochable, clair, élégant — cf. brief Eliot.
 *
 * Pattern : ligne horizontale dashed + pill centrée + date ISO.
 * Le bleu accent encadre la pill, ancrage premium.
 */
interface SegmentDividerProps {
  date: string;
  label?: string;
}

export function SegmentDivider({ date, label = 'Refonte structurelle' }: SegmentDividerProps) {
  return (
    <div
      className="relative my-12 flex items-center"
      role="separator"
      aria-label={`${label} — ${date}`}
    >
      <div
        className="h-px flex-1"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--tr-b-strong), var(--tr-acc-glow), var(--tr-b-strong), transparent)',
        }}
      />
      <div
        className="mx-4 flex flex-col items-center gap-1.5 rounded-full border px-5 py-2"
        style={{
          background: 'var(--tr-bg-1)',
          borderColor: 'color-mix(in oklab, var(--tr-acc), transparent 55%)',
          boxShadow: 'var(--tr-sh-cta)',
        }}
      >
        <span className="text-[10px] font-medium tracking-[0.12em] text-[var(--tr-acc-hi)] uppercase">
          {label}
        </span>
        <span className="font-mono text-[13px] text-[var(--tr-t-1)] tabular-nums">{date}</span>
      </div>
      <div
        className="h-px flex-1"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--tr-b-strong), var(--tr-acc-glow), var(--tr-b-strong), transparent)',
        }}
      />
    </div>
  );
}
