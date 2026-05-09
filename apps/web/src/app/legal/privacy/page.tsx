import type { Metadata } from 'next';

import { LegalLayout } from '@/components/legal/legal-layout';

/**
 * `/legal/privacy` — Politique de confidentialité (RGPD).
 *
 * Server Component. Texte rédigé sur mesure pour Fxmily V1 :
 *  - cohorte privée (formation Eliot, 30 → 100 → milliers)
 *  - aucun tracker tiers, aucun pixel publicitaire (SPEC §16)
 *  - Resend (emails), Hetzner (hosting EU), Cloudflare R2 (médias),
 *    Sentry (monitoring), Anthropic (rapports admin uniquement)
 *
 * Le ton reste authentique (Eliot parle), pas de juridisme robotique. La
 * section "Tes droits RGPD" pointe vers `/account/data` et `/account/delete`,
 * tous deux livrés en Phase A.5/A.6 du même jalon.
 */

export const metadata: Metadata = {
  title: 'Confidentialité',
  description:
    'Comment Fxmily traite tes données personnelles : finalités, durées de conservation, droits RGPD, sous-traitants.',
};

export default function PrivacyPolicyPage(): React.ReactElement {
  return (
    <LegalLayout
      eyebrow="Confidentialité"
      title="Politique de confidentialité"
      lastUpdatedIso="2026-05-08"
      summary={
        <>
          Fxmily est un outil interne de la formation Fxmily, réservé aux membres invités. Ce
          document explique <strong>quelles données on garde, pourquoi, combien de temps</strong>,
          et comment tu peux toutes les récupérer ou tout faire effacer.
        </>
      }
    >
      <h2>1. Qui traite tes données ?</h2>
      <p>
        Le responsable de traitement est <strong>Eliot Pena</strong>, éditeur et utilisateur unique
        de Fxmily, joignable à <a href="mailto:eliot@fxmilyapp.com">eliot@fxmilyapp.com</a>. Voir
        aussi nos <a href="/legal/mentions">mentions légales</a> pour l&apos;hébergeur et
        l&apos;adresse postale.
      </p>

      <h2>2. Quelles données on collecte</h2>
      <p>
        Fxmily ne collecte <strong>que</strong> ce qui sert à fonctionner :
      </p>
      <ul>
        <li>
          <strong>Identité &amp; compte</strong> — email, prénom, nom, mot de passe (haché en
          argon2id, jamais stocké en clair), fuseau horaire, date d&apos;inscription, dernière
          connexion. Base légale : exécution du contrat (membre / éditeur).
        </li>
        <li>
          <strong>Journal de trades</strong> — paire, direction, session, sizing, R planifié, R
          réalisé, screenshots avant/après que tu uploades volontairement. Base légale : exécution
          du contrat.
        </li>
        <li>
          <strong>Check-ins quotidiens</strong> — humeur, sommeil, discipline, gratitude, intention
          du jour. Base légale : exécution du contrat (suivi comportemental volontaire).
        </li>
        <li>
          <strong>Score comportemental</strong> — snapshots calculés chaque nuit à partir de tes
          trades + check-ins, sur fenêtre glissante 30 jours. Base légale : intérêt légitime
          (mesurer ta progression).
        </li>
        <li>
          <strong>Notifications push</strong> — abonnements WebPush (endpoint, clés publiques P-256,
          user-agent, dernière vue). On ne logge jamais le contenu envoyé. Base légale :
          consentement (toggle activable et désactivable à tout moment).
        </li>
        <li>
          <strong>Logs d&apos;audit</strong> — actions sensibles (login, création de trade, export
          de données…) avec un hash SHA-256 salé de ton IP (jamais l&apos;IP en clair) et un
          user-agent tronqué à 512 caractères. Base légale : intérêt légitime (sécurité).
        </li>
      </ul>

      <p>
        Fxmily <strong>n&apos;utilise aucun tracker tiers</strong> : pas de Google Analytics, pas de
        Meta Pixel, pas de cookies publicitaires, pas de fingerprint. Voir le bandeau cookie affiché
        en bas d&apos;écran à ta première visite.
      </p>

      <h2>3. Pourquoi ces données</h2>
      <p>
        Trois finalités, et c&apos;est tout : (1) faire fonctionner le compte (auth, journal,
        check-ins), (2) calculer ton score comportemental et te le restituer dans le dashboard, (3)
        générer un rapport hebdomadaire que <strong>seul Eliot</strong> reçoit, pour mieux
        t&apos;accompagner en formation. Aucune donnée n&apos;est utilisée pour de la publicité, de
        la revente, ou de l&apos;entraînement de modèle d&apos;IA tiers.
      </p>

      <h2>4. Combien de temps on les garde</h2>
      <ul>
        <li>
          <strong>Compte actif</strong> — toutes les données ci-dessus, tant que tu es membre.
        </li>
        <li>
          <strong>Compte supprimé</strong> — soft-delete immédiat (PII scrubbée, login bloqué), puis
          purge définitive sous <strong>30 jours</strong>. Tu peux annuler ta suppression dans les
          24h via un lien email.
        </li>
        <li>
          <strong>Logs d&apos;audit</strong> — 12 mois maximum (rétention sécurité, hashs IP non
          réversibles).
        </li>
        <li>
          <strong>Sauvegardes Postgres chiffrées</strong> — 30 jours en R2 cross-région. Une demande
          d&apos;effacement RGPD purge les sauvegardes au prochain cycle (≤ 30 jours).
        </li>
        <li>
          <strong>Abonnements push inactifs</strong> — purgés automatiquement après 90 jours sans
          dispatch réussi.
        </li>
      </ul>

      <h2>5. Sous-traitants (article 28 RGPD)</h2>
      <ul>
        <li>
          <strong>Hetzner Online GmbH</strong> (Allemagne, UE) — hébergement applicatif et base de
          données. Données stockées chiffrées au repos.
        </li>
        <li>
          <strong>Cloudflare, Inc.</strong> — DNS et stockage médias R2 (chiffré au repos). Pas de
          Cloudflare Analytics activé.
        </li>
        <li>
          <strong>Resend, Inc.</strong> (États-Unis, clauses contractuelles types) — envoi
          d&apos;emails transactionnels (invitation, digest hebdo). Aucun email marketing.
        </li>
        <li>
          <strong>Sentry, Inc.</strong> (États-Unis, clauses contractuelles types) — collecte
          d&apos;erreurs serveur (stack trace + user-agent + URL anonymisée). Pas de session replay,
          pas de PII utilisateur dans les payloads (configuration côté code).
        </li>
        <li>
          <strong>Anthropic PBC</strong> (États-Unis, clauses contractuelles types) — modèle Claude
          (famille Sonnet) utilisé pour générer le rapport hebdo Eliot uniquement. Les inputs ne
          sont pas réutilisés pour entraîner un modèle (politique zero-retention Anthropic).
        </li>
      </ul>

      <h2>6. Tes droits RGPD</h2>
      <p>
        Tu disposes des droits d&apos;
        <strong>accès, rectification, effacement, limitation, portabilité, opposition</strong>, et
        tu peux retirer ton consentement à tout moment :
      </p>
      <ul>
        <li>
          <strong>Accès &amp; portabilité</strong> — exporte 100 % de tes données au format JSON
          depuis <a href="/account/data">/account/data</a>. Le fichier inclut compte, trades,
          check-ins, scores, fiches Mark Douglas reçues, abonnements push, logs.
        </li>
        <li>
          <strong>Effacement</strong> — tu peux supprimer ton compte depuis{' '}
          <a href="/account/delete">/account/delete</a>. Soft-delete immédiat, hard-delete sous 30
          jours, fenêtre d&apos;annulation 24h par email.
        </li>
        <li>
          <strong>Rectification &amp; opposition</strong> — par email à{' '}
          <a href="mailto:eliot@fxmilyapp.com">eliot@fxmilyapp.com</a>, réponse sous 30 jours
          (article 12 RGPD).
        </li>
        <li>
          <strong>Réclamation</strong> — si tu estimes que tes droits ne sont pas respectés, tu peux
          saisir la <a href="https://www.cnil.fr/fr/plaintes">CNIL</a> (autorité française de
          contrôle).
        </li>
      </ul>

      <h2>7. Sécurité</h2>
      <p>
        Mots de passe hachés en argon2id, secrets jamais committés en clair, transport TLS 1.3 forcé
        via Caddy + HSTS preload, tokens d&apos;invitation hashés en SHA-256, IPs des logs
        d&apos;audit hashées avec un sel propriétaire. Sauvegardes chiffrées GPG AES-256 avant
        upload R2. Aucune carte bancaire n&apos;est stockée par Fxmily V1 (formation hors-app).
      </p>

      <h2>8. Modifications</h2>
      <p>
        Toute évolution matérielle de cette politique est annoncée par email aux membres actifs avec
        un préavis de 14 jours minimum. La date de dernière mise à jour figure en haut de ce
        document.
      </p>
    </LegalLayout>
  );
}
