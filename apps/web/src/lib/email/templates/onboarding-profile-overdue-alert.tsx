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

interface OnboardingProfileOverdueAlertEmailProps {
  /** Completed interviews of active members with no MemberProfile past 24h. */
  overdueCount: number;
  /** FR date label of the oldest overdue completion (PII-free), or null. */
  oldestLabel: string | null;
  /** Absolute URL to the admin dashboard (built by the caller). */
  adminUrl: string;
}

/**
 * S2 — onboarding profile ADMIN ops nudge (profilage permanence, 3rd twin of
 * the §26 calendar / §25 monthly nudges).
 *
 * Sent ONLY to the operator (`WEEKLY_REPORT_RECIPIENT`) when completed
 * onboarding interviews are missing their MemberProfile past the 24h
 * member-facing promise. The actionable step is LOCAL (run the onboarding
 * batch — ban-risk human-in-the-loop §5.4), so the body spells that out ; the
 * CTA opens the admin dashboard. Internal ops email → calm, count-only, no
 * member PII. The engine line deliberately says « le moteur Claude local »
 * WITHOUT naming a model (anti-drift : the pinned model lives in code, not in
 * email copy that would silently rot on the next model bump).
 */
export function OnboardingProfileOverdueAlertEmail({
  overdueCount,
  oldestLabel,
  adminUrl,
}: OnboardingProfileOverdueAlertEmailProps) {
  const plural = overdueCount > 1;

  return (
    <Html lang="fr">
      <Head>
        <title>Profils d&apos;onboarding en attente · Fxmily</title>
      </Head>
      <Preview>
        {`${overdueCount} profil${plural ? 's' : ''} d'onboarding en attente (promesse 24h dépassée), lance le batch`}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily · Admin</span>
          </Section>

          <Text style={eyebrow}>PROFIL D&apos;ONBOARDING · PERMANENCE</Text>

          <Heading style={heading}>
            {overdueCount} membre{plural ? 's' : ''} {plural ? 'attendent' : 'attend'} leur profil
            d’onboarding.
          </Heading>

          <Text style={paragraph}>
            {overdueCount} membre{plural ? 's' : ''} actif{plural ? 's' : ''} {plural ? 'ont' : 'a'}{' '}
            complété leur entretien d&apos;onboarding il y a plus de 24h sans recevoir leur profil
            {oldestLabel ? (
              <>
                {' '}
                (le plus ancien attend depuis le <strong>{oldestLabel}</strong>)
              </>
            ) : null}
            . L&apos;app leur promet leur profil « dans les prochaines 24h ».
          </Text>

          <Section style={actionCard}>
            <Text style={actionEyebrow}>À FAIRE · DEPUIS TON PC</Text>
            <Text style={actionStep}>
              <span style={dot}>·</span> Lance{' '}
              <span style={code}>bash ops/scripts/onboarding-batch-local.sh</span>.
            </Text>
            <Text style={actionStep}>
              <span style={dot}>·</span> Le moteur Claude local ($0) synthétise les profils,
              persistés après les garde-fous §2.
            </Text>
            <Text style={actionStep}>
              <span style={dot}>·</span> Les membres voient leur profil dans « Mon profil » dès la
              fin du batch.
            </Text>
          </Section>

          <Section style={ctaSection}>
            <Button href={adminUrl} style={button}>
              Ouvrir l&apos;admin →
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            Rappel automatique de permanence, envoyé uniquement quand des profils d&apos;onboarding
            sont en attente passé le délai de courtoisie. Aucun profil généré sur un serveur (le
            batch reste manuel, par sécurité du compte).
          </Text>
          <Text style={footerSign}>Fxmily ops</Text>
        </Container>

        <Text style={legal}>Aucun conseil de marché. Cohorte privée. © 2026 Fxmily.</Text>
      </Body>
    </Html>
  );
}

OnboardingProfileOverdueAlertEmail.PreviewProps = {
  overdueCount: 2,
  oldestLabel: '8 juin 2026',
  adminUrl: 'https://app.fxmilyapp.com/admin',
} satisfies OnboardingProfileOverdueAlertEmailProps;

export default OnboardingProfileOverdueAlertEmail;

// ============================================================
// STYLES (email-safe inline, hex from DS-v2 tokens)
// ============================================================

const body: React.CSSProperties = {
  backgroundColor: '#07090f',
  color: '#ecedf2',
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif',
  margin: 0,
  padding: '32px 16px',
};

const container: React.CSSProperties = {
  backgroundColor: '#0f131c',
  borderRadius: 16,
  padding: '32px 28px',
  maxWidth: 520,
  margin: '0 auto',
  border: '1px solid rgba(120, 128, 150, 0.14)',
};

const brand: React.CSSProperties = { marginBottom: 24 };

const logoBadge: React.CSSProperties = {
  display: 'inline-block',
  width: 24,
  height: 24,
  lineHeight: '24px',
  textAlign: 'center',
  borderRadius: 6,
  border: '1px solid rgba(59, 130, 246, 0.42)',
  backgroundColor: 'rgba(59, 130, 246, 0.14)',
  color: '#3b82f6',
  fontWeight: 700,
  fontSize: 12,
  marginRight: 10,
  verticalAlign: 'middle',
};

const brandName: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 15,
  letterSpacing: '-0.01em',
  color: '#ecedf2',
  verticalAlign: 'middle',
};

const eyebrow: React.CSSProperties = {
  color: '#8c92a3',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  margin: '0 0 8px 0',
};

const heading: React.CSSProperties = {
  color: '#ecedf2',
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: '-0.025em',
  lineHeight: '32px',
  margin: '0 0 16px 0',
};

const paragraph: React.CSSProperties = {
  color: '#b8bdc9',
  fontSize: 15,
  lineHeight: '23px',
  margin: '0 0 20px 0',
};

const actionCard: React.CSSProperties = {
  backgroundColor: 'rgba(59, 130, 246, 0.06)',
  border: '1px solid rgba(59, 130, 246, 0.24)',
  borderRadius: 12,
  padding: '16px 18px',
  margin: '0 0 8px 0',
};

const actionEyebrow: React.CSSProperties = {
  ...eyebrow,
  color: '#3b82f6',
  margin: '0 0 10px 0',
};

const actionStep: React.CSSProperties = {
  color: '#b8bdc9',
  fontSize: 14,
  lineHeight: '21px',
  margin: '0 0 6px 0',
};

const dot: React.CSSProperties = { color: '#3b82f6', marginRight: 8, fontWeight: 700 };

const code: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
  color: '#ecedf2',
  backgroundColor: 'rgba(120, 128, 150, 0.16)',
  borderRadius: 4,
  padding: '1px 5px',
};

const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '24px 0 4px 0' };

const button: React.CSSProperties = {
  backgroundColor: '#3364db',
  color: '#f3f9ff',
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '0.005em',
  textDecoration: 'none',
  padding: '13px 26px',
  borderRadius: 6,
  display: 'inline-block',
  boxShadow:
    '0 1px 0 rgba(255, 255, 255, 0.18) inset, 0 0 0 1px rgba(59, 130, 246, 0.65), 0 8px 16px -4px rgba(59, 130, 246, 0.30)',
};

const hr: React.CSSProperties = {
  borderColor: 'rgba(120, 128, 150, 0.14)',
  margin: '24px 0 18px 0',
};

const footer: React.CSSProperties = {
  color: '#8c92a3',
  fontSize: 12,
  lineHeight: '18px',
  margin: '0 0 8px 0',
};

const footerSign: React.CSSProperties = {
  color: '#b8bdc9',
  fontSize: 13,
  fontWeight: 500,
  margin: '12px 0 0 0',
};

const legal: React.CSSProperties = {
  color: '#74798a',
  fontSize: 11,
  textAlign: 'center',
  margin: '20px 0 0 0',
  fontStyle: 'italic',
};
