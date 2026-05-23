/**
 * Marqueur visuel entre trades historiques (ODS importé) et trades en direct
 * (ajoutés par l'admin). Brief Eliot : « pause claire, élégante, transition
 * irréprochable, parfaitement compréhensible au premier regard ».
 *
 * Pattern T2 : ligne hairline gradient bleu signature + pill centré avec
 * label sobre + date. Le bleu accent encadre la pill = ancrage premium sans
 * saturation.
 */
interface SegmentDividerProps {
  date: string;
  label?: string;
}

export function SegmentDivider({ date, label = 'Trades publiés en direct' }: SegmentDividerProps) {
  return (
    <div
      className="relative my-16 flex items-center"
      role="separator"
      aria-label={`${label} — à partir du ${date}`}
    >
      <div
        className="h-px flex-1"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--border), var(--accent-edge), var(--border), transparent)',
        }}
      />
      <div
        className="mx-5 flex flex-col items-center gap-1.5 rounded-full border px-5 py-2.5"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--accent-edge)',
          boxShadow: '0 0 24px -8px var(--accent-soft)',
        }}
      >
        <span className="t-caption" style={{ color: 'var(--accent)' }}>
          {label}
        </span>
        <span className="num text-[12px] text-[var(--text-muted)] tabular-nums">{date}</span>
      </div>
      <div
        className="h-px flex-1"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--border), var(--accent-edge), var(--border), transparent)',
        }}
      />
    </div>
  );
}
