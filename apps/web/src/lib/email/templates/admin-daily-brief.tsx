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

interface AdminDailyBriefEmailProps {
  /** Human FR date label, e.g. "lundi 6 juillet". */
  dateLabel: string;
  /** Triage queue counts (from getTriageQueueCounts). */
  uncommentedClosed: number;
  staleOpen: number;
  openDiscrepancies: number;
  behavioralSignals: number;
  triageTotal: number;
  /** Distinct members with a new behavioral signal in the last 24h. */
  newSignalMembers: number;
  /** Active members drifting away (not seen for a week). */
  disengagedMembers: number;
  /** Absolute URL to the « À traiter » work queue. */
  triageUrl: string;
  /** Absolute URL to the admin dashboard. */
  adminUrl: string;
}

/**
 * Tour 15 — daily ADMIN brief email (« mon tableau de bord du matin »).
 *
 * Sent ONCE a day to the operator (`WEEKLY_REPORT_RECIPIENT`) so the coach starts
 * the day knowing where to look without opening the app. Count-only, calm,
 * factual — never a verdict (SPEC §2). No member PII: the identities live behind
 * the admin links, never in the body. The CTA opens the « À traiter » queue where
 * every count becomes an actionable list.
 */
export function AdminDailyBriefEmail({
  dateLabel,
  uncommentedClosed,
  staleOpen,
  openDiscrepancies,
  behavioralSignals,
  triageTotal,
  newSignalMembers,
  disengagedMembers,
  triageUrl,
  adminUrl,
}: AdminDailyBriefEmailProps) {
  const allCalm = triageTotal === 0 && newSignalMembers === 0 && disengagedMembers === 0;

  return (
    <Html lang="fr">
      <Head>
        <title>Brief du jour · Fxmily Admin</title>
      </Head>
      <Preview>
        {allCalm
          ? `Rien ne réclame ton attention aujourd'hui · ${dateLabel}`
          : `${triageTotal} en file, ${newSignalMembers} signal${
              newSignalMembers > 1 ? 'aux' : ''
            } depuis hier · ${dateLabel}`}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily · Admin</span>
          </Section>

          <Text style={eyebrow}>BRIEF DU JOUR · {dateLabel.toUpperCase()}</Text>

          {allCalm ? (
            <>
              <Heading style={heading}>Rien ne réclame ton attention.</Heading>
              <Text style={paragraph}>
                La file de travail est vide, aucun nouveau signal comportemental depuis hier et
                personne ne décroche. Journée calme, tu peux avancer sereinement.
              </Text>
            </>
          ) : (
            <>
              <Heading style={heading}>Ton point du matin.</Heading>
              <Text style={paragraph}>
                Voici où porter ton regard aujourd&apos;hui, rangé du plus concret au plus discret.
                Tout part de signaux déjà mesurés, rien de nouveau à calculer de ton côté.
              </Text>

              <Section style={statCard}>
                <Text style={statEyebrow}>FILE DE TRAVAIL</Text>
                <Text style={statLine}>
                  <span style={dot}>·</span> {uncommentedClosed} trade
                  {uncommentedClosed > 1 ? 's' : ''} à commenter
                </Text>
                <Text style={statLine}>
                  <span style={dot}>·</span> {staleOpen} trade{staleOpen > 1 ? 's' : ''} resté
                  {staleOpen > 1 ? 's' : ''} ouvert{staleOpen > 1 ? 's' : ''}
                </Text>
                <Text style={statLine}>
                  <span style={dot}>·</span> {openDiscrepancies} écart
                  {openDiscrepancies > 1 ? 's' : ''} en attente
                </Text>
                <Text style={statLine}>
                  <span style={dot}>·</span> {behavioralSignals} membre
                  {behavioralSignals > 1 ? 's' : ''} avec un signal comportemental récent
                </Text>
                <Text style={statTotal}>
                  {triageTotal} élément{triageTotal > 1 ? 's' : ''} au total dans la file.
                </Text>
              </Section>

              <Section style={statCard}>
                <Text style={statEyebrow}>DEPUIS HIER</Text>
                <Text style={statLine}>
                  <span style={dot}>·</span> {newSignalMembers} membre
                  {newSignalMembers > 1 ? 's' : ''} avec un nouveau signal comportemental
                </Text>
                <Text style={statLine}>
                  <span style={dot}>·</span> {disengagedMembers} membre
                  {disengagedMembers > 1 ? 's' : ''} qui décroche
                  {disengagedMembers > 1 ? 'nt' : ''} (pas revu{disengagedMembers > 1 ? 's' : ''}{' '}
                  depuis une semaine)
                </Text>
              </Section>
            </>
          )}

          <Section style={ctaSection}>
            <Button href={triageUrl} style={button}>
              Ouvrir la file de travail →
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            Brief automatique envoyé une fois par jour. Compteurs uniquement, aucune donnée
            nominative dans cet email : le détail reste dans ton espace admin ({' '}
            <a href={adminUrl} style={footerLink}>
              console
            </a>
            ).
          </Text>
          <Text style={footerSign}>Fxmily ops</Text>
        </Container>

        <Text style={legal}>Aucun conseil de marché. Cohorte privée. © 2026 Fxmily.</Text>
      </Body>
    </Html>
  );
}

AdminDailyBriefEmail.PreviewProps = {
  dateLabel: 'lundi 6 juillet',
  uncommentedClosed: 3,
  staleOpen: 1,
  openDiscrepancies: 2,
  behavioralSignals: 4,
  triageTotal: 10,
  newSignalMembers: 2,
  disengagedMembers: 1,
  triageUrl: 'https://app.fxmilyapp.com/admin/a-traiter',
  adminUrl: 'https://app.fxmilyapp.com/admin',
} satisfies AdminDailyBriefEmailProps;

export default AdminDailyBriefEmail;

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

const statCard: React.CSSProperties = {
  backgroundColor: 'rgba(59, 130, 246, 0.06)',
  border: '1px solid rgba(59, 130, 246, 0.24)',
  borderRadius: 12,
  padding: '16px 18px',
  margin: '0 0 12px 0',
};

const statEyebrow: React.CSSProperties = {
  ...eyebrow,
  color: '#3b82f6',
  margin: '0 0 10px 0',
};

const statLine: React.CSSProperties = {
  color: '#b8bdc9',
  fontSize: 14,
  lineHeight: '21px',
  margin: '0 0 6px 0',
};

const statTotal: React.CSSProperties = {
  color: '#ecedf2',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: '21px',
  margin: '10px 0 0 0',
};

const dot: React.CSSProperties = { color: '#3b82f6', marginRight: 8, fontWeight: 700 };

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

const footerLink: React.CSSProperties = {
  color: '#8fb0f6',
  textDecoration: 'underline',
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
