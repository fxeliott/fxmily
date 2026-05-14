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
 *    pas un acteur autonome. Eliot reste le coach humain.
 *  - Pas de jargon juridique robotique : Eliot parle directement.
 *  - Conforme au principe SPEC §2 (pas de conseil sur analyses de trade).
 */

export const metadata: Metadata = {
  title: 'Transparence IA',
  description:
    "Comment Fxmily utilise l'intelligence artificielle (Claude, Anthropic) — limites, garanties, et ce qu'elle ne fait jamais.",
};

export default function AIDisclosurePage(): React.ReactElement {
  return (
    <LegalLayout
      eyebrow="Transparence IA"
      title="Comment Fxmily utilise l'IA"
      lastUpdatedIso="2026-05-14"
      summary={
        <>
          Fxmily utilise une IA générative (Claude, Anthropic) pour{' '}
          <strong>un seul cas d&apos;usage</strong> : rédiger ton rapport hebdomadaire à partir de
          tes propres données. Pas de conseil de trade, pas de décision autonome, pas de
          remplacement du coaching humain.
        </>
      }
    >
      <h2>1. Pourquoi cette page existe</h2>
      <p>
        Le règlement européen sur l&apos;intelligence artificielle (EU AI Act, entré en vigueur le 2
        août 2024) impose à toute application qui interagit avec une personne via une IA générative
        d&apos;être <strong>explicite</strong> sur ce point. L&apos;article 50(1) du règlement est
        d&apos;application directe à partir du <strong>2 août 2026</strong>. Cette page est notre
        engagement de transparence avant cette échéance.
      </p>

      <h2>2. Quel modèle on utilise, pour quoi</h2>
      <ul>
        <li>
          <strong>Modèle</strong> — Claude (famille Sonnet), édité par Anthropic PBC. Les rapports
          sont générés via l&apos;abonnement personnel Max d&apos;Eliot (pas d&apos;API Anthropic
          facturée par requête côté Fxmily — voir{' '}
          <a href="/legal/privacy">Politique de confidentialité §3</a> pour les sous-traitants).
        </li>
        <li>
          <strong>Usage unique</strong> — rédaction du <em>rapport hebdomadaire</em> que tu reçois
          chaque dimanche par email et qui s&apos;affiche dans l&apos;onglet Admin pour Eliot. Le
          rapport synthétise <strong>tes propres données</strong> (trades de la semaine, check-ins,
          notes) en un texte lisible.
        </li>
        <li>
          <strong>Volume</strong> — 1 appel par utilisateur par semaine, plafonné à $5 de tokens par
          run (garde-fou technique côté Eliot pour éviter toute dérive de coût).
        </li>
      </ul>

      <h2>3. Ce que l&apos;IA ne fait jamais</h2>
      <ul>
        <li>
          <strong>Aucun conseil de trade.</strong> Aucun prompt n&apos;autorise l&apos;IA à dire
          quoi acheter, vendre, garder, fermer, ou hedger. Voir <a href="/legal/terms">CGU §4</a>{' '}
          (posture éducative SPEC §2).
        </li>
        <li>
          <strong>Aucune décision autonome.</strong> L&apos;IA est un exécuteur de prompt. Elle ne
          déclenche pas d&apos;action, n&apos;envoie pas de message à un tiers, ne modifie pas tes
          paramètres, ne te catégorise pas en archétype fixe.
        </li>
        <li>
          <strong>Aucune personnalisation comportementale.</strong> Tes données ne sont pas envoyées
          à un système qui apprendrait de toi pour t&apos;influencer (pas de ML re-training sur tes
          contenus, pas de profilage marketing, pas de scoring de personnalité).
        </li>
        <li>
          <strong>Aucun remplacement du coaching humain.</strong> Eliot reste ton interlocuteur
          humain. L&apos;IA produit un brouillon ; Eliot le lit, le corrige, ou l&apos;ignore. Si tu
          as une question sur ton parcours, tu écris à Eliot, pas au rapport IA.
        </li>
        <li>
          <strong>Aucun audio, aucune voix.</strong> Pas de TTS, pas d&apos;enregistrement, pas
          d&apos;analyse vocale. Décision produit explicite (SPEC §2).
        </li>
      </ul>

      <h2>4. Garde-fous techniques</h2>
      <ul>
        <li>
          <strong>Détection d&apos;injection de prompt</strong> — toute donnée que tu saisis (notes
          d&apos;humeur, journal, descriptions de trades) est filtrée par un détecteur multi-vecteur
          côté serveur avant d&apos;être incluse dans le contexte envoyé à l&apos;IA. Si un pattern
          suspect est détecté (ex. tentative d&apos;injecter des instructions adverses), la donnée
          est neutralisée et un audit log est créé.
        </li>
        <li>
          <strong>Filtre de routage de crise</strong> — si une donnée que tu saisis contient des
          marqueurs de détresse psychologique (mots-clés FR, regex unicode-aware exclusive des
          expressions argot trading), un message t&apos;orientant vers les ressources de soutien
          national (3114, SOS Amitié, Suicide Écoute) s&apos;affiche, et la donnée est conservée
          mais marquée pour revue humaine par Eliot. L&apos;IA n&apos;est pas appelée sur ce
          contenu.
        </li>
        <li>
          <strong>Budget plafonné</strong> — chaque appel IA est limité à $5 de tokens. Au-delà, la
          requête est refusée et journalisée. Garantie de non-explosion de coûts.
        </li>
        <li>
          <strong>Banner de transparence</strong> — chaque contenu généré par IA (rapport admin,
          email hebdomadaire) affiche le bandeau « Généré par IA — pas substitut coaching humain ».
        </li>
      </ul>

      <h2>5. Tes droits spécifiques au contenu IA</h2>
      <p>
        En plus de tes droits RGPD généraux (voir{' '}
        <a href="/legal/privacy">Politique de confidentialité §6</a>), l&apos;EU AI Act te garantit
        :
      </p>
      <ul>
        <li>
          <strong>Droit de savoir</strong> — tout contenu qui t&apos;est destiné et qui a été généré
          par IA porte le bandeau de transparence ci-dessus. Pas de prose IA déguisée en écriture
          humaine.
        </li>
        <li>
          <strong>Droit de refuser le contenu IA</strong> — tu peux désactiver l&apos;envoi du
          rapport hebdomadaire dans{' '}
          <a href="/account/notifications">tes préférences de notifications</a>. Le rapport ne sera
          plus généré, ni envoyé, ni stocké pour toi.
        </li>
        <li>
          <strong>Droit de signaler une erreur</strong> — si un rapport contient une affirmation
          fausse ou inappropriée, signale-le à{' '}
          <a href="mailto:eliot@fxmilyapp.com">eliot@fxmilyapp.com</a>. Eliot revoit manuellement et
          ajuste le prompt si nécessaire.
        </li>
      </ul>

      <h2>6. Ce que tu peux croire vs ce qui reste à toi</h2>
      <p>
        Un rapport généré par IA est un <strong>brouillon de réflexion</strong>. Il peut contenir
        des biais (hallucination, sur-généralisation, ton trop affirmatif). Le traiter comme une
        vérité absolue serait une erreur. À l&apos;inverse, ignorer toute observation sous prétexte
        qu&apos;elle vient d&apos;une IA serait excessif aussi.
      </p>
      <p>
        La bonne posture, alignée avec le framework Mark Douglas que Fxmily applique :{' '}
        <strong>chaque observation est une probabilité, pas une certitude</strong>. Tu peux
        l&apos;accepter, la nuancer, ou la rejeter selon ce que tu connais de toi.
      </p>

      <h2>7. Sécurité et chaîne de traitement</h2>
      <ul>
        <li>
          <strong>Données envoyées à l&apos;IA</strong> — uniquement ton journal de trades agrégé
          (statistiques numériques), tes check-ins de la semaine (humeur 1-5, mots-clés), tes notes
          libres. Aucune information directement identifiante (nom, email, IP).
        </li>
        <li>
          <strong>Conservation côté Anthropic</strong> — Anthropic indique ne pas utiliser les
          contenus de l&apos;abonnement Max pour ré-entraîner ses modèles (voir{' '}
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
          <strong>Conservation côté Fxmily</strong> — le rapport est stocké dans la base Fxmily
          (Hetzner Allemagne) chiffré au repos, et purgé selon la durée de conservation indiquée
          dans la <a href="/legal/privacy">Politique de confidentialité §4</a>.
        </li>
      </ul>

      <h2>8. Mises à jour de cette page</h2>
      <p>
        Toute évolution du modèle IA utilisé, du périmètre d&apos;usage, ou de la chaîne de
        traitement sera reflétée ici dans les 30 jours. La date de dernière mise à jour est indiquée
        en haut de page. Pour toute question, écris à{' '}
        <a href="mailto:eliot@fxmilyapp.com">eliot@fxmilyapp.com</a>.
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
            Règlement (UE) 2024/1689 — texte intégral EUR-Lex
          </a>
        </li>
        <li>
          <a
            href="https://artificialintelligenceact.eu/article/50/"
            rel="noopener noreferrer external"
            target="_blank"
          >
            Article 50 — Obligations de transparence
          </a>
        </li>
        <li>
          <a
            href="https://artificialintelligenceact.eu/article/99/"
            rel="noopener noreferrer external"
            target="_blank"
          >
            Article 99 — Pénalités administratives
          </a>
        </li>
      </ul>
    </LegalLayout>
  );
}
