import type { Metadata } from 'next';

import { LegalLayout } from '@/components/legal/legal-layout';

/**
 * `/legal/mentions` — Mentions légales (article 6 LCEN).
 *
 * Identifie l'éditeur, l'hébergeur, le directeur de la publication et le
 * canal de signalement. Reste volontairement court — V1 cohorte privée
 * sans activité commerciale grand public.
 */

export const metadata: Metadata = {
  title: 'Mentions légales',
  description:
    'Éditeur, hébergeur, directeur de la publication et contact de Fxmily, conformément à la LCEN article 6.',
};

export default function MentionsPage(): React.ReactElement {
  return (
    <LegalLayout
      eyebrow="Mentions légales"
      title="Mentions légales"
      lastUpdatedIso="2026-05-08"
      summary={
        <>
          Informations exigées par l&apos;<strong>article 6 de la LCEN</strong> (loi n° 2004-575 du
          21 juin 2004 pour la confiance dans l&apos;économie numérique).
        </>
      }
    >
      <h2>Éditeur</h2>
      <p>
        <strong>Eliot Pena</strong>, éditeur du service Fxmily.
        <br />
        Adresse postale : Cournonterral, France (communiquée sur demande à
        <a href="mailto:eliot@fxmilyapp.com">&nbsp;eliot@fxmilyapp.com</a>, conformément à
        l&apos;article 6 III 2° de la LCEN — particulier non-professionnel).
        <br />
        Contact : <a href="mailto:eliot@fxmilyapp.com">eliot@fxmilyapp.com</a>
      </p>

      <h2>Directeur de la publication</h2>
      <p>Eliot Pena, en sa qualité d&apos;éditeur.</p>

      <h2>Hébergeur</h2>
      <p>
        <strong>Hetzner Online GmbH</strong>
        <br />
        Industriestraße 25, 91710 Gunzenhausen, Allemagne
        <br />
        Téléphone : +49 9831 505-0 · Site web :{' '}
        <a href="https://www.hetzner.com">www.hetzner.com</a>
      </p>

      <h2>Nom de domaine</h2>
      <p>
        <code>fxmilyapp.com</code>, déposé via Cloudflare Registrar (Cloudflare, Inc., 101 Townsend
        Street, San Francisco, CA 94107, USA).
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        Le code source, le design DS v2, les paraphrases issues du framework Mark Douglas, le nom
        Fxmily et son logo sont la propriété exclusive de l&apos;éditeur. Toute reproduction,
        adaptation ou diffusion non autorisée est interdite (articles L122-4 et L335-2 du Code de la
        propriété intellectuelle).
      </p>

      <h2>Signalement</h2>
      <p>
        Tout contenu illicite hébergé sur Fxmily peut être signalé par email à{' '}
        <a href="mailto:eliot@fxmilyapp.com">eliot@fxmilyapp.com</a>. Conformément à l&apos;article
        6 I 2° de la LCEN, l&apos;éditeur retirera ou rendra inaccessible le contenu manifestement
        illicite dès qu&apos;il en aura connaissance.
      </p>

      <h2>Documents associés</h2>
      <ul>
        <li>
          <a href="/legal/privacy">Politique de confidentialité (RGPD)</a>
        </li>
        <li>
          <a href="/legal/terms">Conditions générales d&apos;utilisation</a>
        </li>
      </ul>
    </LegalLayout>
  );
}
