/**
 * Disclaimer AMF — formulations conformes Règlement Général AMF en vigueur
 * (2026) + recommandations AMF/ESMA finfluenceurs janvier 2026 + loi 9 juin
 * 2023 sur l'influence commerciale.
 *
 * Researcher audit 2026-05-22 : le numéro d'article exact (314-14 / 314-30)
 * a évolué entre versions RGAMF ; éviter de citer un numéro qui pourrait
 * être périmé → formulation générique "Règlement Général AMF en vigueur".
 *
 * Mentions obligatoires intégrées :
 *  - Past performance (formule canonique AMF + MiFID II)
 *  - Risque substantiel de perte en capital
 *  - Statut non-CIF (Article L. 321-1 du Code monétaire et financier)
 *  - Période exhaustive (RGAMF — tranches complètes, aucune exclusion)
 *  - Identification publique (loi 9 juin 2023)
 *  - Nature éducative (anti-requalification CIF)
 *
 * Placement "en bonne place" obligatoire — pas footer 9px (Guide AMF
 * communications promotionnelles 2021).
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
        <strong className="text-[var(--tr-t-1)]">
          Les performances passées ne préjugent pas des performances futures.
        </strong>{' '}
        Les chiffres présentés sur cette page ont trait à des périodes écoulées et ne sont pas un
        indicateur fiable des performances futures (Règlement Général AMF en vigueur).
      </p>
      <p className="mb-3">
        Le trading sur instruments à effet de levier (CFD, forex, futures) comporte un{' '}
        <strong className="text-[var(--tr-t-1)]">risque substantiel de perte en capital</strong>. Il
        n&apos;est adapté qu&apos;aux personnes ayant les moyens financiers de supporter cette perte
        et la connaissance suffisante pour évaluer le risque.
      </p>
      <p className="mb-3">
        Cette page documente une démarche pédagogique à des fins de formation. Elle ne constitue ni
        un conseil en investissement personnalisé au sens de l&apos;article L. 321-1 du Code
        monétaire et financier, ni une recommandation, ni une incitation à acheter ou vendre un
        instrument financier.{' '}
        <strong className="text-[var(--tr-t-1)]">
          Fxmily n&apos;est pas un Conseiller en Investissements Financiers (CIF)
        </strong>{' '}
        et n&apos;est pas immatriculé à l&apos;ORIAS à ce titre.
      </p>
      <p>
        <span className="text-[var(--tr-t-3)]">
          Période documentée intégralement, aucun trade retiré, aucune période exclue. Les résultats
          individuels des membres dépendent de leur exécution personnelle, de leur gestion du risque
          et des conditions de marché.{' '}
        </span>
        <strong className="text-[var(--tr-t-2)]">
          Aucun rendement n&apos;est garanti ni promis.
        </strong>
      </p>
    </section>
  );
}
