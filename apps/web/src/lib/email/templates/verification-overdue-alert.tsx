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

interface VerificationOverdueAlertEmailProps {
  /** Pending MT5 proofs of active members awaiting the vision batch past 24h. */
  overdueCount: number;
  /** FR date label of the oldest overdue upload (PII-free), or null. */
  oldestLabel: string | null;
  /** Absolute URL to the admin dashboard (built by the caller). */
  adminUrl: string;
}

/**
 * AUTONOMY-1 — MT5 proof VISION ADMIN ops nudge (vérification permanence, 5th
 * twin of the §26 calendar / §25 monthly / S2 onboarding / J8 weekly nudges).
 *
 * Sent ONLY to the operator (`WEEKLY_REPORT_RECIPIENT`) when MT5 account proofs
 * stay `pending` past the grace window — i.e. the member uploaded a proof but
 * the manual vision batch was never run, so their account/positions are never
 * extracted and they wait indefinitely with no signal. The actionable step is
 * LOCAL (run the `claude --print` vision batch — ban-risk human-in-the-loop
 * §5.4), so the body spells that out ; the CTA opens the admin dashboard.
 * Internal ops email → calm, count-only, no member PII. The engine line
 * deliberately says « le moteur Claude local » WITHOUT naming a model
 * (anti-drift : the pinned model lives in code, not in email copy that would
 * silently rot on the next model bump).
 */
export function VerificationOverdueAlertEmail({
  overdueCount,
  oldestLabel,
  adminUrl,
}: VerificationOverdueAlertEmailProps) {
  const plural = overdueCount > 1;

  return (
    <Html lang="fr">
      <Head>
        <title>Preuves MT5 en attente d&apos;analyse · Fxmily</title>
      </Head>
      <Preview>
        {`${overdueCount} preuve${plural ? 's' : ''} MT5 en attente d'analyse (vision) — lance le batch`}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily · Admin</span>
          </Section>

          <Text style={eyebrow}>VÉRIFICATION MT5 · PERMANENCE</Text>

          <Heading style={heading}>
            {overdueCount} preuve{plural ? 's' : ''} MT5 {plural ? 'attendent' : 'attend'} leur
            analyse vision.
          </Heading>

          <Text style={paragraph}>
            {overdueCount} membre{plural ? 's' : ''} actif{plural ? 's' : ''} {plural ? 'ont' : 'a'}{' '}
            envoyé une preuve de compte MT5 il y a plus de 24h sans qu&apos;elle soit analysée
            {oldestLabel ? (
              <>
                {' '}
                (la plus ancienne attend depuis le <strong>{oldestLabel}</strong>)
              </>
            ) : null}
            . Tant que le batch vision n&apos;est pas lancé, le compte et les positions ne sont
            jamais extraits.
          </Text>

          <Section style={actionCard}>
            <Text style={actionEyebrow}>À FAIRE — DEPUIS TON PC</Text>
            <Text style={actionStep}>
              <span style={dot}>·</span> Lance <span style={code}>/verification-batch</span> (ou{' '}
              <span style={code}>bash ops/scripts/verification-batch-local.sh</span>).
            </Text>
            <Text style={actionStep}>
              <span style={dot}>·</span> Le moteur Claude local ($0) lit les preuves et extrait
              comptes + positions, persistés après les garde-fous §2.
            </Text>
            <Text style={actionStep}>
              <span style={dot}>·</span> Les membres voient leur vérification à jour dès la fin du
              batch.
            </Text>
          </Section>

          <Section style={ctaSection}>
            <Button href={adminUrl} style={button}>
              Ouvrir l&apos;admin →
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            Rappel automatique de permanence — envoyé uniquement quand des preuves MT5 sont en
            attente d&apos;analyse passé le délai de courtoisie. Aucune preuve analysée sur un
            serveur (le batch vision reste manuel, par sécurité du compte).
          </Text>
          <Text style={footerSign}>— Fxmily ops</Text>
        </Container>

        <Text style={legal}>Aucun conseil de marché. Cohorte privée. © 2026 Fxmily.</Text>
      </Body>
    </Html>
  );
}

VerificationOverdueAlertEmail.PreviewProps = {
  overdueCount: 2,
  oldestLabel: '8 juin 2026',
  adminUrl: 'https://app.fxmilyapp.com/admin',
} satisfies VerificationOverdueAlertEmailProps;

export default VerificationOverdueAlertEmail;

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
