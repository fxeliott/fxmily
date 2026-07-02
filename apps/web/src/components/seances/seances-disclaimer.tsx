import { Info } from 'lucide-react';

/**
 * Educational disclaimer footer (Server Component) — mandatory on every séance
 * surface (mirror the static hub layout footer). Posture §2 / AI Act-safe: this
 * content is a faithful REPLAY + summary of Eliott's own formation session, for
 * educational purposes only — neither investment advice nor an incitement, with
 * an explicit capital-loss warning. 0 mention of IA / model / version.
 */
export function SeancesDisclaimer() {
  return (
    <footer className="mt-2 border-t border-[var(--b-default)] pt-4">
      <p className="t-cap flex items-start gap-2 text-[var(--t-3)]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span>
          Replays et comptes rendus des séances de formation, à but pédagogique et informatif. Il ne
          s&apos;agit ni d&apos;un conseil en investissement ni d&apos;une incitation à investir. Le
          trading comporte un risque de perte en capital. Accès réservé aux membres.
        </span>
      </p>
    </footer>
  );
}
