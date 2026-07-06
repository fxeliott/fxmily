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

interface PasswordResetEmailProps {
  resetUrl: string;
  /** Member's first name when known — personalises the greeting (SPEC §7.1). */
  firstName: string | null | undefined;
  expiresInMinutes: number;
}

/**
 * Email "mot de passe oublié" Fxmily — DS-v3 blue sur deep space.
 *
 * Email-safe : valeurs hex inline (pas de CSS variables / OKLCH — support email
 * client encore patchy en 2026), palette traduite depuis tokens.css comme le
 * template d'invitation. Ton : sobre, sécurité-first, jamais alarmiste.
 */
export function PasswordResetEmail({
  resetUrl,
  firstName,
  expiresInMinutes,
}: PasswordResetEmailProps) {
  const name = firstName?.trim() ? firstName.trim() : null;

  return (
    <Html lang="fr">
      <Head>
        <title>Réinitialiser ton mot de passe Fxmily</title>
      </Head>
      <Preview>{`Réinitialise ton mot de passe Fxmily, lien valable ${expiresInMinutes} minutes`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily</span>
          </Section>

          <Text style={eyebrow}>SÉCURITÉ · MOT DE PASSE</Text>

          <Heading style={heading}>{name ? `${name},` : 'Réinitialisation'}</Heading>

          <Text style={paragraph}>
            Tu as demandé à réinitialiser ton mot de passe Fxmily. Clique sur le bouton ci-dessous
            pour en choisir un nouveau.
          </Text>

          <Section style={ctaSection}>
            <Button href={resetUrl} style={button}>
              Choisir un nouveau mot de passe →
            </Button>
          </Section>

          <Text style={smallParagraph}>
            Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :
            <br />
            <Link href={resetUrl} style={link}>
              {resetUrl}
            </Link>
          </Text>

          <Hr style={hr} />

          <Text style={footer}>
            Ce lien expire dans {expiresInMinutes} minutes et ne peut servir qu’une seule fois. Si
            tu n’es pas à l’origine de cette demande, ignore cet email, ton mot de passe actuel
            reste inchangé et ton compte est en sécurité.
          </Text>

          <Text style={footerSign}>L&apos;équipe Fxmily</Text>
        </Container>

        <Text style={legal}>
          Aucun conseil de marché. Cohorte privée invitation-only. © 2026 Fxmily.
        </Text>
      </Body>
    </Html>
  );
}

PasswordResetEmail.PreviewProps = {
  resetUrl: 'https://app.fxmilyapp.com/reset-password?token=preview',
  firstName: 'Eliott',
  expiresInMinutes: 30,
} satisfies PasswordResetEmailProps;

export default PasswordResetEmail;

// ============================================================
// STYLES (email-safe inline, hex translated from OKLCH tokens)
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

const smallParagraph: React.CSSProperties = {
  color: '#74798a', // --t-4
  fontSize: 12,
  lineHeight: '18px',
  margin: '24px 0 0 0',
  wordBreak: 'break-all',
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
