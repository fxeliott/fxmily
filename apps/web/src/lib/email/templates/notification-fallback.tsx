import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

import type { NotificationTypeSlug } from '@/lib/schemas/push-subscription';

interface NotificationFallbackEmailProps {
  /** Member's first name — falls back to "Trader" if missing. */
  recipientFirstName: string | null | undefined;
  /** The kind of notification that failed to dispatch via Web Push. */
  type: NotificationTypeSlug;
  /** Deep link to the relevant in-app surface (trade, checkin, fiche, report). */
  deepUrl: string;
  /**
   * Delivery channel. `'fallback'` (default) = this email is sent AFTER Web
   * Push failed its retries (the historic use). `'primary'` = this email IS
   * the primary, immediate channel (S7 training corrections) — the footer must
   * NOT claim a push failure, which would be factually wrong.
   */
  channel?: 'fallback' | 'primary';
}

/**
 * Email fallback envoyé quand une push notification a échoué après MAX_ATTEMPTS
 * (SPEC §18.2 mitigation iOS push fragility). Posture sereine : la notif a
 * échoué côté infrastructure, pas côté membre — ton serene, factuel,
 * actionable. Pas de "TU N'AS PAS REÇU !!" anxiogène.
 *
 * Email-safe inline hex (cf. invitation.tsx). Design DS-v3 blue sur deep space
 * — réutilise les tokens visuels d'`annotation-received.tsx`.
 *
 * 1 template générique avec mapping `type` → headline + body + cta. DRY pour
 * éviter la duplication de 5 templates quasi-identiques.
 */
export function NotificationFallbackEmail({
  recipientFirstName,
  type,
  deepUrl,
  channel = 'fallback',
}: NotificationFallbackEmailProps) {
  const recipient = recipientFirstName?.trim() ? recipientFirstName.trim() : 'Trader';
  const meta = META_BY_TYPE[type];

  return (
    <Html lang="fr">
      <Head>
        <title>{meta.title}</title>
      </Head>
      <Preview>{meta.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily</span>
          </Section>

          <Text style={eyebrow}>{meta.eyebrow}</Text>

          <Heading style={heading}>Salut {recipient},</Heading>

          <Text style={paragraph}>{meta.body}</Text>

          <Section style={ctaSection}>
            <Button href={deepUrl} style={button}>
              {meta.ctaLabel}
            </Button>
          </Section>

          <Hr style={divider} />

          <Text style={footer}>
            {channel === 'primary'
              ? 'Cet email accompagne ta notification dans l’app. Tu peux ajuster les catégories de notification dans ton compte.'
              : 'Cet email t’est envoyé en repli quand une notification push n’a pas pu être délivrée à ton appareil (Web Push iOS reste fragile en 2026, SPEC §18.2). Tu peux ajuster les catégories de notification dans ton compte.'}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/**
 * Per-type copy. Each variant mirrors the push payload built by
 * `lib/push/dispatcher.ts:buildPayload` for consistency — the email is the
 * fallback text of the same nudge, not a different message.
 */
const META_BY_TYPE: Record<
  NotificationTypeSlug,
  {
    title: string;
    preview: string;
    eyebrow: string;
    body: string;
    ctaLabel: string;
  }
> = {
  annotation_received: {
    title: 'Nouvelle correction reçue',
    preview: 'Eliott a laissé une correction sur l’un de tes trades.',
    eyebrow: 'CORRECTION · COACHING',
    body: "Eliott a laissé une correction sur l'un de tes trades. Le détail t'attend dans ton journal, la correction sera marquée comme lue dès que tu ouvres le trade.",
    ctaLabel: 'Voir la correction →',
  },
  training_annotation_received: {
    title: 'Correction reçue (entraînement)',
    preview: 'Eliott a laissé une correction sur l’un de tes backtests.',
    eyebrow: 'CORRECTION · ENTRAÎNEMENT',
    body: "Eliott a laissé une correction sur l'un de tes backtests. Le détail t'attend dans ton espace entraînement, la correction sera marquée comme lue dès que tu ouvres le backtest.",
    ctaLabel: 'Voir la correction →',
  },
  checkin_morning_reminder: {
    title: 'Check-in matin',
    preview: 'Trois minutes pour poser ton intention du jour.',
    eyebrow: 'CHECK-IN · MATIN',
    body: 'Trois minutes pour poser ton intention du jour. Pas de rattrapage, si la fenêtre est passée, on se retrouve ce soir.',
    ctaLabel: 'Faire le check-in matin →',
  },
  checkin_evening_reminder: {
    title: 'Check-in soir',
    preview: 'Bilan rapide du jour : plan, ressenti, gratitude.',
    eyebrow: 'CHECK-IN · SOIR',
    body: 'Bilan rapide du jour : plan, ressenti, gratitude. Trois minutes pour fermer la journée proprement.',
    ctaLabel: 'Faire le check-in soir →',
  },
  douglas_card_delivered: {
    title: 'Nouvelle fiche Mark Douglas',
    preview: 'Une fiche est arrivée dans ta bibliothèque.',
    eyebrow: 'MARK DOUGLAS · FICHE',
    body: 'Une fiche est arrivée dans ta bibliothèque, choisie selon ton activité récente. Lis-la quand le moment te paraît juste.',
    ctaLabel: 'Lire la fiche →',
  },
  weekly_report_ready: {
    title: 'Rapport hebdo prêt',
    preview: 'Ton digest hebdomadaire des membres est prêt.',
    eyebrow: 'RAPPORT HEBDO · ADMIN',
    body: 'Ton digest hebdomadaire des membres a été généré.',
    ctaLabel: 'Ouvrir le rapport →',
  },
  monthly_debrief_ready: {
    title: 'Ton débrief mensuel est prêt',
    preview: 'Une synthèse du mois écoulé t’attend.',
    eyebrow: 'DÉBRIEF MENSUEL · IA',
    body: 'Une synthèse du mois écoulé t’attend : progression, trading réel, entraînement. Un moment pour prendre du recul, à ton rythme.',
    ctaLabel: 'Ouvrir mon débrief →',
  },
  // V1.5 §27.6 dispose "push-only, no email" — defense-in-depth copy if the
  // fallback ever fires (push failed 3× + non-transactional + cap not reached).
  mindset_check_ready: {
    title: 'Auto-évaluation mindset prête',
    preview: 'Ton QCM hebdo de 2 minutes est disponible.',
    eyebrow: 'MINDSET · QCM HEBDO',
    body: 'Ton QCM hebdo de 2 minutes pour mesurer où tu en es : mindset, discipline, patience. Calme et sans pression.',
    ctaLabel: 'Faire mon QCM hebdo →',
  },
  // S3 §33 — push-only (EMAIL_FALLBACK_SKIP_TYPES). Defense-in-depth copy only.
  verification_gentle_reminder: {
    title: 'Un point rapide sur ton suivi',
    preview: 'Un élément de ton suivi est resté de côté.',
    eyebrow: 'SUIVI · RAPPEL',
    body: 'Un élément de ton suivi est resté de côté. Un coup d’œil quand tu peux, et indique s’il y a une raison. Rien de grave : juste rester honnête avec toi-même.',
    ctaLabel: 'Voir mon suivi →',
  },
  // Tour 14 — member-facing verdict (mirror monthly_debrief_ready, email fallback allowed).
  verification_proof_analyzed: {
    title: 'Ton analyse de suivi est prête',
    preview: 'Le résultat de ton suivi t’attend sur ta page de vérification.',
    eyebrow: 'VÉRIFICATION · ANALYSE',
    body: 'Ton analyse de suivi est prête. Les positions lues et les éventuels écarts t’attendent sur ta page de vérification. Un moment pour te voir tel que tu es, sans jugement.',
    ctaLabel: 'Voir mon analyse →',
  },
  // S8 V2 §32-4 — ADMIN-facing: a member replied to a backtest correction.
  training_reply_received: {
    title: 'Réponse à une correction',
    preview: 'Un membre a répondu à l’une de tes corrections.',
    eyebrow: 'ENTRAÎNEMENT · RÉPONSE',
    body: 'Un membre a répondu à l’une de tes corrections de backtest. Le détail t’attend dans son espace entraînement, côté admin.',
    ctaLabel: 'Voir la réponse →',
  },
  // J2 — Sunday-morning nudge to complete the weekly review if not yet done.
  weekly_review_reminder: {
    title: 'Ta revue de la semaine',
    preview: 'Prends un moment pour faire le point sur ta semaine.',
    eyebrow: 'REVUE · HEBDO',
    body: 'Prends un moment pour faire le point sur ta semaine, tranquillement.',
    ctaLabel: 'Faire ma revue →',
  },
  // J2 — fires when the member's weekly adaptive calendar is published.
  calendar_ready: {
    title: 'Ton plan de la semaine est prêt',
    preview: 'Ton calendrier de la semaine vient d’être publié.',
    eyebrow: 'CALENDRIER · SEMAINE',
    body: 'Ton calendrier de la semaine vient d’être publié.',
    ctaLabel: 'Voir mon calendrier →',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Email-safe inline styles (carbon copy of `annotation-received.tsx` palette).
// ─────────────────────────────────────────────────────────────────────────────

const body: React.CSSProperties = {
  margin: 0,
  padding: 0,
  backgroundColor: '#0b0d12',
  color: '#e6e8ee',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const container: React.CSSProperties = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '32px 24px 40px',
};

const brand: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  marginBottom: '32px',
};

const logoBadge: React.CSSProperties = {
  display: 'inline-block',
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  backgroundColor: '#3364db',
  color: '#f3f9ff',
  fontWeight: 700,
  fontSize: '18px',
  textAlign: 'center',
  lineHeight: '32px',
};

const brandName: React.CSSProperties = {
  fontSize: '14px',
  letterSpacing: '0.04em',
  color: '#a3a3a3',
  textTransform: 'uppercase',
};

const eyebrow: React.CSSProperties = {
  fontSize: '11px',
  letterSpacing: '0.18em',
  color: '#9ca3af',
  textTransform: 'uppercase',
  marginBottom: '16px',
};

const heading: React.CSSProperties = {
  fontSize: '28px',
  lineHeight: '1.2',
  fontWeight: 600,
  color: '#f3f4f6',
  margin: '0 0 16px 0',
};

const paragraph: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#d1d5db',
  margin: '0 0 16px 0',
};

const ctaSection: React.CSSProperties = {
  margin: '28px 0 12px',
};

const button: React.CSSProperties = {
  backgroundColor: '#3364db',
  color: '#f3f9ff',
  borderRadius: '8px',
  padding: '12px 20px',
  fontSize: '15px',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-block',
};

const divider: React.CSSProperties = {
  borderColor: '#1f2937',
  margin: '32px 0 20px',
};

const footer: React.CSSProperties = {
  fontSize: '12px',
  lineHeight: '1.5',
  color: '#6b7280',
  margin: 0,
};
