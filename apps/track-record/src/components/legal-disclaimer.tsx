/**
 * Disclaimer AMF — formulation verbatim Règlement Général AMF
 * (article 314-14 RGAMF + Règlement délégué UE 2017/565 art. 44 post-MiFID II).
 *
 * Placement OBLIGATOIRE "en bonne place" (pas footer 9px) — voir Guide AMF
 * communications promotionnelles 2021. Inline ici sous la section performance.
 *
 * Pas de promesse de gain. Pas de "centre de l'information" sur la performance.
 */
export function LegalDisclaimer() {
  return (
    <section
      className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] p-6 text-sm leading-relaxed text-[var(--tr-t-2)]"
      role="region"
      aria-label="Information réglementaire"
    >
      <div className="mb-3 inline-flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-[var(--tr-warn)] uppercase">
        <span aria-hidden>⚠</span> Information réglementaire
      </div>
      <p className="mb-3">
        Les chiffres cités ont trait aux périodes écoulées et{' '}
        <strong className="text-[var(--tr-t-1)]">
          les performances passées ne sont pas un indicateur fiable des performances futures
        </strong>
        . Cette page documente une démarche pédagogique à des fins de formation. Elle ne constitue
        ni un conseil en investissement, ni une recommandation personnalisée, ni une incitation à
        acheter ou vendre un instrument financier.
      </p>
      <p className="mb-3">
        Le trading sur instruments à effet de levier (CFD, forex, futures) comporte un risque élevé
        de perte rapide en capital. Il n&apos;est adapté qu&apos;aux personnes ayant les moyens
        financiers de supporter cette perte et la connaissance suffisante pour évaluer le risque.
      </p>
      <p className="text-[var(--tr-t-3)]">
        Fxmily n&apos;est pas un prestataire de services d&apos;investissement régulé par l&apos;AMF
        (Autorité des Marchés Financiers). Les résultats individuels des membres dépendent de leur
        exécution personnelle, de leur gestion du risque et des conditions de marché.{' '}
        <strong className="text-[var(--tr-t-2)]">
          Aucun rendement n&apos;est garanti ni promis.
        </strong>
      </p>
    </section>
  );
}
