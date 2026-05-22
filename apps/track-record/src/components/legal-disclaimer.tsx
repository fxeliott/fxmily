/**
 * Disclaimer AMF T1 — ultra-condensé, footer-style (3 phrases courtes).
 * Maintien des mentions légales obligatoires (RGAMF + non-CIF) en formulation
 * ramassée, sans jargon technique. Ton sobre, neutre.
 */
export function LegalDisclaimer() {
  return (
    <div
      role="region"
      aria-label="Information réglementaire"
      className="border-t border-[var(--border)] pt-8 text-[var(--text-subtle)]"
    >
      <p className="t-micro leading-relaxed">
        Les performances passées ne préjugent pas des performances futures. Le trading sur
        instruments à effet de levier comporte un risque substantiel de perte en capital.
      </p>
      <p className="t-micro mt-3 leading-relaxed">
        Cette page documente une démarche pédagogique à des fins de formation. Elle ne constitue pas
        un conseil en investissement personnalisé au sens de l&apos;article L. 321-1 du Code
        monétaire et financier. Fxmily n&apos;est pas Conseiller en Investissements Financiers.
        Aucun rendement n&apos;est garanti.
      </p>
    </div>
  );
}
