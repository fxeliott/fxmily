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

interface AccessRequestReceivedAlertEmailProps {
  /** Total pending access requests at notification time (count-only, no PII). */
  pendingCount: number;
  /** Absolute URL to the admin access-request queue (built by the caller). */
  adminUrl: string;
}

/**
 * Email ADMIN — nouvelle demande d'accès reçue (§26.2 « l'admin la reçoit DE
 * DEUX FAÇONS : par EMAIL ET sur son profil admin »).
 *
 * Ferme la moitié "par email" du §26.2 qui manquait (seule la queue admin
 * existait). Envoyé UNIQUEMENT à l'opérateur (`WEEKLY_REPORT_RECIPIENT`) quand
 * une NOUVELLE demande est créée. Interne, ops, count-only : AUCUNE PII du
 * demandeur (ni nom ni email) — la PII vit dans la row `AccessRequest` (avec son
 * propre cron de purge) ; la mettre dans l'email casserait la minimisation RGPD.
 * Le CTA ouvre la file `/admin/access-requests`. Best-effort : le caller
 * (`app/rejoindre/actions.ts`) ne casse jamais la demande si l'envoi échoue.
 */
export function AccessRequestReceivedAlertEmail({
  pendingCount,
  adminUrl,
}: AccessRequestReceivedAlertEmailProps) {
  const plural = pendingCount > 1;

  return (
    <Html lang="fr">
      <Head>
        <title>Nouvelle demande d&apos;accès · Fxmily</title>
      </Head>
      <Preview>
        {`Nouvelle demande d'accès : ${pendingCount} en attente. Ouvre la file pour valider ou refuser.`}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily · Admin</span>
          </Section>

          <Text style={eyebrow}>DEMANDE D&apos;ACCÈS · NOTIFICATION</Text>

          <Heading style={heading}>Une nouvelle demande d&apos;accès est arrivée.</Heading>

          <Text style={paragraph}>
            {pendingCount} demande{plural ? 's' : ''} {plural ? 'sont' : 'est'} en attente de
            validation dans ta file d’accès. Tu peux les accepter ou les refuser depuis ton espace
            admin.
          </Text>

          <Section style={ctaSection}>
            <Button href={adminUrl} style={button}>
              Voir les demandes →
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            Notification automatique, envoyée à chaque nouvelle demande. Le détail (prénom, nom,
            email du demandeur) reste dans l&apos;espace admin, jamais dans cet email.
          </Text>

          <Text style={footerSign}>Fxmily</Text>
        </Container>

        <Text style={legal}>Cohorte privée invitation-only. © 2026 Fxmily.</Text>
      </Body>
    </Html>
  );
}

AccessRequestReceivedAlertEmail.PreviewProps = {
  pendingCount: 3,
  adminUrl: 'https://app.fxmilyapp.com/admin/access-requests',
} satisfies AccessRequestReceivedAlertEmailProps;

export default AccessRequestReceivedAlertEmail;

// ============================================================
// STYLES (email-safe inline, hex translated from OKLCH tokens)
// Mirror de access-approved.tsx (même DS deep-space + CTA blue).
// ============================================================

const body: React.CSSProperties = {
  backgroundColor: '#07090f', // --bg
  color: '#ecedf2', // --t-1
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif',
  margin: 0,
  padding: '32px 16px',
};

const container: React.CSSProperties = {
  backgroundColor: '#0f131c', // --bg-1
  borderRadius: 16,
  padding: '32px 28px',
  maxWidth: 520,
  margin: '0 auto',
  border: '1px solid rgba(120, 128, 150, 0.14)', // --b-default
};

const brand: React.CSSProperties = {
  marginBottom: 24,
};

const logoBadge: React.CSSProperties = {
  display: 'inline-block',
  width: 24,
  height: 24,
  lineHeight: '24px',
  textAlign: 'center',
  borderRadius: 6,
  border: '1px solid rgba(59, 130, 246, 0.42)', // --b-acc
  backgroundColor: 'rgba(59, 130, 246, 0.14)', // --acc-dim
  color: '#3b82f6', // --acc
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
  color: '#8c92a3', // --t-3
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  margin: '0 0 8px 0',
};

const heading: React.CSSProperties = {
  color: '#ecedf2', // --t-1
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: '-0.03em',
  lineHeight: '30px',
  margin: '0 0 20px 0',
};

const paragraph: React.CSSProperties = {
  color: '#b8bdc9', // --t-2
  fontSize: 15,
  lineHeight: '23px',
  margin: '0 0 14px 0',
};

const ctaSection: React.CSSProperties = {
  textAlign: 'center',
  margin: '28px 0',
};

const button: React.CSSProperties = {
  backgroundColor: '#3364db', // --acc-btn (DS-v3 blue CTA)
  color: '#f3f9ff', // --acc-fg
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '0.005em',
  textDecoration: 'none',
  padding: '14px 28px',
  borderRadius: 6,
  display: 'inline-block',
  boxShadow:
    '0 1px 0 rgba(255, 255, 255, 0.18) inset, 0 0 0 1px rgba(59, 130, 246, 0.65), 0 8px 16px -4px rgba(59, 130, 246, 0.30)',
};

const hr: React.CSSProperties = {
  borderColor: 'rgba(120, 128, 150, 0.14)', // --b-default
  margin: '28px 0 20px 0',
};

const footer: React.CSSProperties = {
  color: '#8c92a3', // --t-3
  fontSize: 12,
  lineHeight: '18px',
  margin: '0 0 8px 0',
};

const footerSign: React.CSSProperties = {
  color: '#b8bdc9',
  fontSize: 13,
  fontWeight: 500,
  margin: '16px 0 0 0',
};

const legal: React.CSSProperties = {
  color: '#74798a',
  fontSize: 11,
  textAlign: 'center',
  margin: '20px 0 0 0',
  fontStyle: 'italic',
};
