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

interface MonthlyDebriefOverdueAlertEmailProps {
  /** Active members waiting on their monthly debrief (none generated). */
  overdueCount: number;
  /** Active members expected a debrief for the month (joined ≤ month end). */
  expectedCount: number;
  /** Human FR month label, e.g. "mai 2026". */
  monthLabel: string;
  /** Absolute URL to the admin dashboard (built by the caller). */
  adminUrl: string;
}

/**
 * V1.4 §25 monthly debrief — ADMIN ops nudge (Session 5, DoD#2 permanence).
 *
 * Sent ONLY to the operator (`WEEKLY_REPORT_RECIPIENT`) when the last completed
 * month's member debriefs were not generated past the grace window. The
 * actionable step is LOCAL (run the `claude --print` monthly batch — ban-risk
 * human-in-the-loop §5.4), so the body spells that out ; the CTA opens the
 * admin dashboard. Internal ops email → calm, count-only, no member PII.
 */
export function MonthlyDebriefOverdueAlertEmail({
  overdueCount,
  expectedCount,
  monthLabel,
  adminUrl,
}: MonthlyDebriefOverdueAlertEmailProps) {
  const plural = overdueCount > 1;

  return (
    <Html lang="fr">
      <Head>
        <title>Débriefs mensuels en attente · Fxmily</title>
      </Head>
      <Preview>
        {`${overdueCount} débrief${plural ? 's' : ''} mensuel${plural ? 's' : ''} en attente (${monthLabel}), lance le batch`}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily · Admin</span>
          </Section>

          <Text style={eyebrow}>DÉBRIEF MENSUEL · {monthLabel.toUpperCase()}</Text>

          <Heading style={heading}>
            {overdueCount} membre{plural ? 's' : ''} {plural ? 'attendent' : 'attend'} leur débrief
            mensuel.
          </Heading>

          <Text style={paragraph}>
            Le mois de <strong>{monthLabel.toLowerCase()}</strong> est terminé, mais {overdueCount}{' '}
            membre
            {plural ? 's' : ''} actif{plural ? 's' : ''}
            {expectedCount > overdueCount ? ` (sur ${expectedCount})` : ''} n’
            {plural ? 'ont' : 'a'} pas encore reçu leur débrief mensuel. Chaque membre actif doit en
            recevoir un (SPEC §25.4).
          </Text>

          <Section style={actionCard}>
            <Text style={actionEyebrow}>À FAIRE · DEPUIS TON PC</Text>
            <Text style={actionStep}>
              <span style={dot}>·</span> Lance <span style={code}>/monthly-batch</span> (ou{' '}
              <span style={code}>ops/scripts/monthly-batch-local.sh</span>).
            </Text>
            <Text style={actionStep}>
              <span style={dot}>·</span> Claude Opus 4.8 rédige les débriefs en local ($0),
              persistés après les garde-fous §2.
            </Text>
            <Text style={actionStep}>
              <span style={dot}>·</span> Les membres reçoivent leur débrief (push + email) dès la
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
            Rappel automatique de permanence, envoyé uniquement quand des débriefs mensuels sont en
            attente passé le délai de courtoisie. Aucun débrief généré sur un serveur (le batch
            reste manuel, par sécurité du compte).
          </Text>
          <Text style={footerSign}>Fxmily ops</Text>
        </Container>

        <Text style={legal}>Aucun conseil de marché. Cohorte privée. © 2026 Fxmily.</Text>
      </Body>
    </Html>
  );
}

MonthlyDebriefOverdueAlertEmail.PreviewProps = {
  overdueCount: 2,
  expectedCount: 5,
  monthLabel: 'mai 2026',
  adminUrl: 'https://app.fxmilyapp.com/admin',
} satisfies MonthlyDebriefOverdueAlertEmailProps;

export default MonthlyDebriefOverdueAlertEmail;

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
