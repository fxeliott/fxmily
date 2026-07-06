import type { Metadata } from 'next';

import { LegalLayout } from '@/components/legal/legal-layout';

/**
 * `/legal/ai-disclosure` — Transparence IA (EU AI Act §50).
 *
 * Server Component. Page de divulgation IA pour Fxmily V1.
 *
 * **Cadre légal** :
 *  - **EU AI Act Article 50(1)** Regulation (EU) 2024/1689 — transparence
 *    pour systèmes IA à risque limité (chatbots, génération de contenu).
 *  - Entrée en vigueur **2 août 2026** (échéance dure).
 *  - Pénalité non-conformité : **€15M ou 3% du CA mondial annuel**
 *    (Article 99(4)).
 *
 * **Sources primaires** :
 *  - https://artificialintelligenceact.eu/article/50/
 *  - https://artificialintelligenceact.eu/article/99/
 *  - https://eur-lex.europa.eu/eli/reg/2024/1689/oj
 *
 * **Posture éditoriale** :
 *  - Anti-anthropomorphisation stricte : l'IA est un *exécuteur de prompt*,
 *    pas un acteur autonome. Eliott reste le coach humain.
 *  - Pas de jargon juridique robotique : Eliott parle directement.
 *  - Conforme au principe SPEC §2 (pas de conseil sur analyses de trade).
 */

export const metadata: Metadata = {
  title: 'Transparence IA',
  description:
    "Comment Fxmily utilise l'intelligence artificielle (Claude, Anthropic), limites, garanties, et ce qu'elle ne fait jamais.",
};

export default function AIDisclosurePage(): React.ReactElement {
  return (
    <LegalLayout
      eyebrow="Transparence IA"
      title="Comment Fxmily utilise l'IA"
      lastUpdatedIso="2026-06-11"
      summary={
        <>
          Fxmily utilise une IA générative (Claude, Anthropic) pour{' '}
          <strong>quatre cas d’usage</strong> : rédiger un rapport hebdomadaire (que{' '}
          <strong>seul Eliott</strong> reçoit, pour assurer ton suivi), ton débrief mensuel (que tu
          consultes), ton calendrier d’organisation hebdomadaire (que tu consultes) et l’analyse
          unique de ton questionnaire d’entrée (ton profil membre), à partir de tes propres données.
          Pas de conseil de trade, pas de décision autonome, pas de remplacement du coaching humain.
        </>
      }
    >
      <h2>1. Pourquoi cette page existe</h2>
      <p>
        Le règlement européen sur l’intelligence artificielle (EU AI Act, entré en vigueur le 1ᵉʳ
        août 2024) impose à toute application qui interagit avec une personne via une IA générative
        d’être <strong>explicite</strong> sur ce point. L’article 50(1) du règlement est
        d’application directe à partir du <strong>2 août 2026</strong>. Cette page est notre
        engagement de transparence avant cette échéance.
      </p>

      <h2>2. Quel modèle on utilise, pour quoi</h2>
      <ul>
        <li>
          <strong>Modèle</strong> : Claude Opus 4.8 (identifiant exact <code>claude-opus-4-8</code>
          ), édité par Anthropic PBC. Les contenus sont générés via l’abonnement personnel Max
          d’Eliott (pas d’API Anthropic facturée par requête côté Fxmily, voir{' '}
          <a href="/legal/privacy">Politique de confidentialité §3</a> pour les sous-traitants).
        </li>
        <li>
          <strong>Quatre usages</strong> : (a) un <em>rapport hebdomadaire</em> que{' '}
          <strong>seul Eliott (admin)</strong> reçoit chaque dimanche par email, pour assurer ton
          suivi, tu ne le reçois pas directement ; il s’affiche dans l’onglet Admin ; (b) ton{' '}
          <em>débrief mensuel</em> (V1.4, SPEC §25.4) consultable sur ta page{' '}
          <a href="/debrief-mensuel">/debrief-mensuel</a> et dans l’onglet Admin (
          <code>?tab=monthly-debrief</code>), il synthétise <strong>tes propres données</strong>{' '}
          (trades, check-ins, notes, progression mois sur mois) ; (c) ton{' '}
          <em>calendrier d’organisation hebdomadaire</em> (§26) consultable sur{' '}
          <a href="/calendrier">/calendrier</a>, généré à partir de ton questionnaire de
          disponibilité et d’un instantané chiffré de ton activité, il organise ton{' '}
          <strong>temps</strong> de pratique (sessions, entraînement, repos), jamais le marché ; (d)
          l’<em>analyse unique de ton questionnaire d’entrée</em> (entretien d’onboarding) qui
          construit ton profil membre, réponses pseudonymisées avant envoi.
        </li>
        <li>
          <strong>Volume</strong> : au plus 1 appel par utilisateur par semaine (rapport hebdo) + 1
          par mois (débrief mensuel) + 1 par semaine pour le calendrier (uniquement si tu remplis le
          questionnaire d’organisation) + 1 appel unique à l’arrivée (analyse du questionnaire
          d’entrée), plafonnés à $15 de tokens par run (garde-fou technique côté Eliott pour éviter
          toute dérive de coût).
        </li>
      </ul>

      <h2>3. Ce que l’IA ne fait jamais</h2>
      <ul>
        <li>
          <strong>Aucun conseil de trade.</strong> Aucun prompt n’autorise l’IA à dire quoi acheter,
          vendre, garder, fermer, ou hedger. Voir <a href="/legal/terms">CGU §4</a> (posture
          éducative SPEC §2).
        </li>
        <li>
          <strong>Aucune décision autonome.</strong> L’IA est un exécuteur de prompt. Elle ne
          déclenche pas d’action, n’envoie pas de message à un tiers, ne modifie pas tes paramètres,
          ne te catégorise pas en archétype fixe.
        </li>
        <li>
          <strong>Aucune personnalisation comportementale.</strong> Tes données ne sont pas envoyées
          à un système qui apprendrait de toi pour t’influencer (pas de ML re-training sur tes
          contenus, pas de profilage marketing, pas de scoring de personnalité).
        </li>
        <li>
          <strong>Aucun remplacement du coaching humain.</strong> Eliott reste ton interlocuteur
          humain. L’IA produit un brouillon ; Eliott le lit, le corrige, ou l’ignore. Si tu as une
          question sur ton parcours, tu écris à Eliott, pas au rapport IA.
        </li>
        <li>
          <strong>Aucun audio, aucune voix.</strong> Pas de TTS, pas d’enregistrement, pas d’analyse
          vocale. Décision produit explicite (SPEC §2).
        </li>
      </ul>

      <h2>4. Garde-fous techniques</h2>
      <ul>
        <li>
          <strong>Détection d’injection de prompt</strong> : toute donnée que tu saisis (notes
          d’humeur, journal, descriptions de trades) est filtrée par un détecteur multi-vecteur côté
          serveur avant d’être incluse dans le contexte envoyé à l’IA. Si un pattern suspect est
          détecté (ex. tentative d’injecter des instructions adverses), la donnée est neutralisée et
          un audit log est créé.
        </li>
        <li>
          <strong>Filtre de routage de crise</strong> : si une donnée que tu saisis contient des
          marqueurs de détresse psychologique (mots-clés FR, regex unicode-aware exclusive des
          expressions argot trading), un message t’orientant vers les ressources de soutien national
          (3114, SOS Amitié, Suicide Écoute) s’affiche, et la donnée est conservée mais marquée pour
          revue humaine par Eliott. L’IA n’est pas appelée sur ce contenu.
        </li>
        <li>
          <strong>Budget plafonné</strong> : chaque appel IA est limité à $15 de tokens. Au-delà, la
          requête est refusée et journalisée. Garantie de non-explosion de coûts.
        </li>
        <li>
          <strong>Banner de transparence</strong> : chaque contenu généré par IA (rapport hebdo
          admin, débrief mensuel, calendrier d’organisation, emails) affiche un bandeau « Généré par
          IA · pas substitut coaching humain ».
        </li>
      </ul>

      <h2>5. Tes droits spécifiques au contenu IA</h2>
      <p>
        En plus de tes droits RGPD généraux (voir{' '}
        <a href="/legal/privacy">Politique de confidentialité §6</a>), l’EU AI Act te garantit :
      </p>
      <ul>
        <li>
          <strong>Droit de savoir</strong> : tout contenu qui t’est destiné et qui a été généré par
          IA porte le bandeau de transparence ci-dessus. Pas de prose IA déguisée en écriture
          humaine.
        </li>
        <li>
          <strong>Droit de refuser le contenu IA</strong> : tu peux désactiver la livraison de ton{' '}
          <em>débrief mensuel</em> dans{' '}
          <a href="/account/notifications">tes préférences de notifications</a> (toggle{' '}
          <code>monthly_debrief_ready</code>). Le contenu désactivé ne sera plus envoyé ni affiché
          pour toi. Le <em>rapport hebdomadaire</em>, lui, ne t’est pas adressé, il est réservé à
          Eliott pour assurer ton suivi.
        </li>
        <li>
          <strong>Droit de signaler une erreur</strong> : si un rapport contient une affirmation
          fausse ou inappropriée, signale-le à{' '}
          <a href="mailto:fxeliott@fxmily.fr">fxeliott@fxmily.fr</a>. Eliott revoit manuellement et
          ajuste le prompt si nécessaire.
        </li>
      </ul>

      <h2>6. Ce que tu peux croire vs ce qui reste à toi</h2>
      <p>
        Un rapport généré par IA est un <strong>brouillon de réflexion</strong>. Il peut contenir
        des biais (hallucination, sur-généralisation, ton trop affirmatif). Le traiter comme une
        vérité absolue serait une erreur. À l’inverse, ignorer toute observation sous prétexte
        qu’elle vient d’une IA serait excessif aussi.
      </p>
      <p>
        La bonne posture, alignée avec le framework Mark Douglas que Fxmily applique :{' '}
        <strong>chaque observation est une probabilité, pas une certitude</strong>. Tu peux
        l’accepter, la nuancer, ou la rejeter selon ce que tu connais de toi.
      </p>

      <h2>7. Sécurité et chaîne de traitement</h2>
      <ul>
        <li>
          <strong>Données envoyées à l’IA</strong> : uniquement ton journal de trades agrégé
          (statistiques numériques), tes check-ins de la semaine (humeur 1-5, mots-clés), tes notes
          libres. Aucune information directement identifiante (nom, email, IP).
        </li>
        <li>
          <strong>Conservation côté Anthropic</strong> : Anthropic indique ne pas utiliser les
          contenus de l’abonnement Max pour ré-entraîner ses modèles (voir{' '}
          <a
            href="https://www.anthropic.com/legal/aup"
            rel="noopener noreferrer external"
            target="_blank"
          >
            Anthropic Acceptable Use Policy
          </a>
          ). Si cette politique change, cette page sera mise à jour avant tout impact.
        </li>
        <li>
          <strong>Conservation côté Fxmily</strong> : le rapport est stocké dans la base Fxmily
          (Hetzner Allemagne) chiffré au repos, et purgé selon la durée de conservation indiquée
          dans la <a href="/legal/privacy">Politique de confidentialité §4</a>.
        </li>
      </ul>

      <h2>8. Mises à jour de cette page</h2>
      <p>
        Toute évolution du modèle IA utilisé, du périmètre d’usage, ou de la chaîne de traitement
        sera reflétée ici dans les 30 jours. La date de dernière mise à jour est indiquée en haut de
        page. Pour toute question, écris à{' '}
        <a href="mailto:fxeliott@fxmily.fr">fxeliott@fxmily.fr</a>.
      </p>

      <h2>9. Références légales</h2>
      <p>Pour aller plus loin :</p>
      <ul>
        <li>
          <a
            href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj"
            rel="noopener noreferrer external"
            target="_blank"
          >
            Règlement (UE) 2024/1689 · texte intégral EUR-Lex
          </a>
        </li>
        <li>
          <a
            href="https://artificialintelligenceact.eu/article/50/"
            rel="noopener noreferrer external"
            target="_blank"
          >
            Article 50 · Obligations de transparence
          </a>
        </li>
        <li>
          <a
            href="https://artificialintelligenceact.eu/article/99/"
            rel="noopener noreferrer external"
            target="_blank"
          >
            Article 99 · Pénalités administratives
          </a>
        </li>
      </ul>
    </LegalLayout>
  );
}
