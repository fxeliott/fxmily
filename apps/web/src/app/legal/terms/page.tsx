import type { Metadata } from 'next';

import { LegalLayout } from '@/components/legal/legal-layout';

/**
 * `/legal/terms` — Conditions générales d'utilisation (CGU).
 *
 * Posture éducation Fxmily SPEC §2 ancrée explicitement :
 *   ❌ Pas de conseil sur les analyses de trade
 *   ✅ Outil pédagogique sur l'exécution + la psychologie (Mark Douglas)
 *
 * Ce document protège Eliot et le membre :
 *   - cadre l'usage strictement à l'auto-suivi (pas un signal service)
 *   - décline toute responsabilité sur les pertes financières
 *   - documente les conditions de suspension et de suppression de compte
 */

export const metadata: Metadata = {
  title: 'CGU',
  description:
    "Conditions générales d'utilisation de Fxmily : posture pédagogique, responsabilités, accès, suppression de compte.",
};

export default function TermsPage(): React.ReactElement {
  return (
    <LegalLayout
      eyebrow="CGU"
      title="Conditions générales d'utilisation"
      lastUpdatedIso="2026-05-08"
      summary={
        <>
          Fxmily est un outil pédagogique de <strong>suivi comportemental</strong> pour les membres
          de la formation Fxmily. Ce n&apos;est ni un signal service, ni un conseil en
          investissement, ni une promesse de gains.
        </>
      }
    >
      <h2>1. Objet</h2>
      <p>
        Fxmily est une application web réservée aux membres invités de la formation de trading
        Fxmily. Elle te permet de tenir un journal de trades, des check-ins quotidiens, et de suivre
        un score comportemental. Elle te diffuse aussi des fiches courtes sur la psychologie du
        trading inspirées du framework Mark Douglas.
      </p>

      <h2>2. Posture éducative — ce que Fxmily n&apos;est pas</h2>
      <p>
        <strong>Fxmily ne donne aucun conseil de trade.</strong> Aucun setup, aucune prévision de
        marché, aucun appel d&apos;achat ou de vente, aucune recommandation de paire. Les contenus
        diffusés portent <strong>uniquement</strong> sur :
      </p>
      <ul>
        <li>
          l&apos;<strong>exécution</strong> — sessions, hedge, plan, sizing, discipline ;
        </li>
        <li>
          la <strong>psychologie</strong> — acceptation du risque, probabilités, gestion de la peur,
          du tilt, de l&apos;ego (citations courtes attribuées + paraphrases originales).
        </li>
      </ul>
      <p>
        Le trading est risqué. Tu peux perdre tout ou partie de ton capital. Fxmily ne garantit
        aucun résultat, ne mesure pas la performance financière, et n&apos;est pas un service de
        conseil en investissement au sens du Code monétaire et financier. Tu restes seul responsable
        de tes décisions de trade.
      </p>

      <h2>3. Accès</h2>
      <p>
        L&apos;accès est <strong>sur invitation uniquement</strong>, émise par Eliot ou un admin
        autorisé. Le compte est strictement personnel et non transférable. Tu t&apos;engages à
        garder ton mot de passe confidentiel et à signaler tout accès suspect.
      </p>

      <h2>4. Tes engagements</h2>
      <ul>
        <li>
          ne pas tenter d&apos;accéder à un autre compte que le tien (réservé : sanctions pénales,
          article 323-1 du Code pénal) ;
        </li>
        <li>
          ne pas uploader de contenu illégal, diffamatoire, ou portant atteinte aux droits
          d&apos;autrui ;
        </li>
        <li>
          ne pas redistribuer publiquement les fiches Mark Douglas reçues (citations sous fair use
          FR L122-5, paraphrases écrites par Eliot) ;
        </li>
        <li>ne pas tenter d&apos;extraire la base de données ou de la rétro-ingénier ;</li>
        <li>
          ne pas utiliser Fxmily comme d&apos;un signal service ou d&apos;un outil de copy-trade
          partagé.
        </li>
      </ul>

      <h2>5. Propriété intellectuelle</h2>
      <p>
        Le code, le design DS v2, les paraphrases Mark Douglas et les marques Fxmily sont la
        propriété d&apos;Eliot Pena. Tes données personnelles (trades, check-ins, journal) restent
        ta propriété — tu peux les exporter ou les effacer à tout moment depuis{' '}
        <a href="/account/data">/account/data</a> et <a href="/account/delete">/account/delete</a>.
      </p>

      <h2>6. Disponibilité</h2>
      <p>
        Fxmily V1 tourne sur un serveur unique Hetzner CX22 (Falkenstein, UE). Aucune garantie de
        disponibilité n&apos;est promise — un incident peut entraîner une indisponibilité
        temporaire. Une maintenance planifiée est annoncée par email avec ≥ 24h de préavis quand
        c&apos;est possible. Sauvegardes quotidiennes chiffrées (cf.{' '}
        <a href="/legal/privacy">politique de confidentialité §4</a>).
      </p>

      <h2>7. Suspension &amp; résiliation</h2>
      <p>
        Eliot se réserve le droit de <strong>suspendre</strong> un compte en cas de violation des
        présentes CGU (notamment §4) ou de comportement portant atteinte aux autres membres. Tu peux
        de ton côté supprimer ton compte à tout moment depuis{' '}
        <a href="/account/delete">/account/delete</a>. Soft-delete immédiat, hard-delete sous 30
        jours.
      </p>

      <h2>8. Responsabilité</h2>
      <p>
        Eliot s&apos;engage à fournir Fxmily avec un soin raisonnable. Sa responsabilité ne peut
        toutefois être engagée pour les pertes financières liées à tes décisions de trade, les
        indisponibilités liées à un sous-traitant (Hetzner, Cloudflare, Resend), ou un cas de force
        majeure. Si une clause des présentes CGU était jugée nulle, les autres resteraient
        applicables.
      </p>

      <h2>9. Droit applicable</h2>
      <p>
        Les présentes CGU sont régies par le droit français. Tout litige relève de la compétence
        exclusive des tribunaux du ressort du siège de l&apos;éditeur, sauf disposition légale
        impérative contraire (notamment droit de la consommation).
      </p>

      <h2>10. Modifications</h2>
      <p>
        Toute modification matérielle des présentes CGU est annoncée par email aux membres actifs
        avec un préavis de 14 jours minimum. La date de dernière mise à jour figure en haut du
        document.
      </p>
    </LegalLayout>
  );
}
