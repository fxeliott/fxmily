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
}

/**
 * Email fallback envoyé quand une push notification a échoué après MAX_ATTEMPTS
 * (SPEC §18.2 mitigation iOS push fragility). Posture sereine : la notif a
 * échoué côté infrastructure, pas côté membre — ton serene, factuel,
 * actionable. Pas de "TU N'AS PAS REÇU !!" anxiogène.
 *
 * Email-safe inline hex (cf. invitation.tsx). Design DS-v2 lime sur deep space
 * — réutilise les tokens visuels d'`annotation-received.tsx`.
 *
 * 1 template générique avec mapping `type` → headline + body + cta. DRY pour
 * éviter la duplication de 5 templates quasi-identiques.
 */
export function NotificationFallbackEmail({
  recipientFirstName,
  type,
  deepUrl,
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
            Cet email t&apos;est envoyé en repli quand une notification push n&apos;a pas pu être
            délivrée à ton appareil (Web Push iOS reste fragile en 2026, SPEC §18.2). Tu peux
            ajuster les catégories de notification dans ton compte.
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
    preview: 'Eliot a laissé une correction sur l’un de tes trades.',
    eyebrow: 'CORRECTION · COACHING',
    body: "Eliot a laissé une correction sur l'un de tes trades. Le détail t'attend dans ton journal — la correction sera marquée comme lue dès que tu ouvres le trade.",
    ctaLabel: 'Voir la correction →',
  },
  checkin_morning_reminder: {
    title: 'Check-in matin',
    preview: 'Trois minutes pour poser ton intention du jour.',
    eyebrow: 'CHECK-IN · MATIN',
    body: 'Trois minutes pour poser ton intention du jour. Pas de rattrapage — si la fenêtre est passée, on se retrouve ce soir.',
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
  backgroundColor: '#bef264',
  color: '#0b0d12',
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
  backgroundColor: '#bef264',
  color: '#0b0d12',
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
