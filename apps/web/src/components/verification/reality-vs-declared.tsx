import type { DiscrepancyDeclaredSide, DiscrepancyRealitySide } from '@/lib/verification/service';

/**
 * S3 — « Réalité vs Déclaré » face-à-face (DoD §33, enrichissement écrit
 * verbatim : « pose face à face, ligne par ligne, ce qu'il a déclaré et ce que
 * l'historique MT5 prouve »).
 *
 * Posture §33.2 (anti Black-Hat, BLOQUANT) : un miroir, pas un tribunal. Jamais
 * de rouge, jamais de vocabulaire de marché ni de conseil — on aligne deux faits
 * (le trade du journal vs la position lue dans la preuve), c'est tout. Une seule
 * colonne peut être vide (position réelle non déclarée, ou trade déclaré sans
 * contrepartie) : le côté manquant affiche un tiret calme, pas une accusation.
 *
 * Données 100 % métadonnées (paire/sens/taille/horaire/P&L), conformes §21.5 :
 * aucune donnée de capture brute (texte OCR, prix lus) n'est rendue — seulement
 * les lignes que le moteur déterministe a appariées.
 */

const DT_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
});

function sideLabel(side: 'long' | 'short'): string {
  return side === 'long' ? 'Long' : 'Short';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="t-cap shrink-0 text-[var(--t-4)]">{label}</dt>
      <dd className="f-mono truncate text-right text-[12px] text-[var(--t-2)] tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function EmptySide({ note }: { note: string }) {
  return (
    <div className="flex min-h-[68px] flex-col items-center justify-center gap-1 text-center">
      <span aria-hidden className="f-mono text-[16px] leading-none text-[var(--t-4)]">
        —
      </span>
      <span className="t-cap max-w-[22ch] text-[var(--t-4)]">{note}</span>
    </div>
  );
}

export function RealityVsDeclared({
  declared,
  reality,
}: {
  declared: DiscrepancyDeclaredSide | null;
  reality: DiscrepancyRealitySide | null;
}) {
  // Nothing to compare (rituals: unfilled / meeting / tracking gaps carry no
  // trade side) — render nothing, the card's reasoning copy stands alone.
  if (!declared && !reality) return null;

  return (
    <div className="rounded-card grid grid-cols-2 gap-px overflow-hidden border border-[var(--cy-edge)] bg-[var(--cy-edge)]">
      {/* Déclaré */}
      <div className="flex flex-col gap-1.5 bg-[var(--bg-1)] p-3">
        <span className="t-cap font-semibold text-[var(--t-3)]">Ce que tu as déclaré</span>
        {declared ? (
          <dl className="flex flex-col gap-1">
            <Row label="Instrument" value={declared.pair} />
            <Row label="Sens" value={sideLabel(declared.direction)} />
            <Row
              label="Taille"
              value={`${declared.lotSize} lot${declared.lotSize > 1 ? 's' : ''}`}
            />
            <Row label="Saisi le" value={DT_FMT.format(declared.enteredAt)} />
          </dl>
        ) : (
          <EmptySide note="Rien de déclaré pour cette position" />
        )}
      </div>

      {/* Réel (historique MT5) */}
      <div className="flex flex-col gap-1.5 bg-[var(--bg-1)] p-3">
        <span className="t-cap font-semibold text-[var(--t-3)]">Ce que ton historique montre</span>
        {reality ? (
          <dl className="flex flex-col gap-1">
            <Row label="Instrument" value={reality.symbol} />
            <Row label="Sens" value={sideLabel(reality.side)} />
            <Row label="Taille" value={`${reality.volume} lot${reality.volume > 1 ? 's' : ''}`} />
            <Row label="Ouvert le" value={DT_FMT.format(reality.openTime)} />
            {reality.pnl !== null ? (
              <Row
                label="P&L"
                value={`${reality.pnl > 0 ? '+' : ''}${reality.pnl.toLocaleString('fr-FR')}`}
              />
            ) : null}
          </dl>
        ) : (
          <EmptySide note="Aucune trace dans l'historique fourni" />
        )}
      </div>
    </div>
  );
}
