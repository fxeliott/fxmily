import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

interface PasswordChangedEmailProps {
  /** Member's first name when known — personalises the greeting (SPEC §7.1). */
  firstName: string | null | undefined;
  /** Absolute "mot de passe oublié" URL — the "ce n'était pas toi" recovery CTA. */
  forgotUrl: string;
}

/** Where a member reports an unexpected change. Mirrors the rejection email. */
const CONTACT_EMAIL = 'fxeliott@fxmily.fr';

/**
 * Email "mot de passe modifié" Fxmily — out-of-band confirmation sent AFTER a
 * password reset completes (OWASP Forgot Password Cheat Sheet: notify the member
 * on every credential change so an account takeover is visible immediately).
 *
 * Carries NO token and NO reset-page link — it is a notification, never an
 * action surface. The only CTA is the recovery path (`/forgot-password`) for the
 * "ce n'était pas toi" case, which re-mints a fresh link to the real inbox.
 *
 * Email-safe : valeurs hex inline (pas de CSS variables / OKLCH — support email
 * client encore patchy en 2026), palette traduite depuis tokens.css comme le
 * template "mot de passe oublié". Ton : sobre, sécurité-first, jamais alarmiste.
 */
export function PasswordChangedEmail({ firstName, forgotUrl }: PasswordChangedEmailProps) {
  const name = firstName?.trim() ? firstName.trim() : null;

  return (
    <Html lang="fr">
      <Head>
        <title>Ton mot de passe Fxmily a été modifié</title>
      </Head>
      <Preview>Ton mot de passe Fxmily vient d&apos;être modifié</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily</span>
          </Section>

          <Text style={eyebrow}>SÉCURITÉ · MOT DE PASSE</Text>

          <Heading style={heading}>{name ? `${name},` : 'Mot de passe modifié'}</Heading>

          <Text style={paragraph}>
            Ton mot de passe Fxmily vient d&apos;être modifié. Si c&apos;est bien toi, tu n&apos;as
            rien à faire — tu peux te connecter avec ton nouveau mot de passe.
          </Text>

          <Text style={paragraph}>
            Par sécurité, toutes tes sessions ouvertes ont été déconnectées : il faudra te
            reconnecter sur chaque appareil.
          </Text>

          <Hr style={hr} />

          <Text style={alertHeading}>Ce n&apos;était pas toi ?</Text>

          <Text style={smallParagraph}>
            Quelqu&apos;un d&apos;autre a peut-être accès à ta boîte mail. Reprends le contrôle
            immédiatement : réinitialise ton mot de passe et écris-nous.
          </Text>

          <Section style={ctaSection}>
            <Button href={forgotUrl} style={button}>
              Sécuriser mon compte →
            </Button>
          </Section>

          <Text style={footer}>
            Préviens-nous tout de suite à{' '}
            <Link href={`mailto:${CONTACT_EMAIL}`} style={link}>
              {CONTACT_EMAIL}
            </Link>{' '}
            pour qu&apos;on bloque l&apos;accès le temps de tout remettre en ordre.
          </Text>

          <Text style={footerSign}>— L&apos;équipe Fxmily</Text>
        </Container>

        <Text style={legal}>
          Aucun conseil de marché. Cohorte privée invitation-only. © 2026 Fxmily.
        </Text>
      </Body>
    </Html>
  );
}

PasswordChangedEmail.PreviewProps = {
  firstName: 'Eliott',
  forgotUrl: 'https://app.fxmilyapp.com/forgot-password',
} satisfies PasswordChangedEmailProps;

export default PasswordChangedEmail;

// ============================================================
// STYLES (email-safe inline, hex translated from OKLCH tokens)
// Mirrors templates/password-reset.tsx for a consistent security voice.
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
  fontSize: 32,
  fontWeight: 700,
  letterSpacing: '-0.03em',
  lineHeight: '36px',
  margin: '0 0 20px 0',
};

const paragraph: React.CSSProperties = {
  color: '#b8bdc9', // --t-2
  fontSize: 15,
  lineHeight: '23px',
  margin: '0 0 14px 0',
};

const alertHeading: React.CSSProperties = {
  color: '#ecedf2', // --t-1
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: '-0.01em',
  margin: '0 0 8px 0',
};

const smallParagraph: React.CSSProperties = {
  color: '#b8bdc9', // --t-2
  fontSize: 14,
  lineHeight: '21px',
  margin: '0 0 4px 0',
};

const ctaSection: React.CSSProperties = {
  textAlign: 'center',
  margin: '24px 0',
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

const link: React.CSSProperties = {
  color: '#3b82f6', // --acc
  textDecoration: 'underline',
};

const hr: React.CSSProperties = {
  borderColor: 'rgba(120, 128, 150, 0.14)', // --b-default
  margin: '28px 0 20px 0',
};

const footer: React.CSSProperties = {
  color: '#8c92a3', // --t-3
  fontSize: 12,
  lineHeight: '18px',
  margin: '16px 0 8px 0',
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
