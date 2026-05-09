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

interface InvitationEmailProps {
  inviteUrl: string;
  invitedByName: string | null | undefined;
  expiresInDays: number;
}

/**
 * Email d'invitation Fxmily — design system v2 lime sur deep space.
 *
 * Email-safe : valeurs hex inline (pas de CSS variables, pas de OKLCH —
 * support email client encore patchy en 2026). Couleurs traduites depuis
 * tokens.css :
 *   --bg #07090f, --bg-1 #0f131c, --acc #a3e635, --acc-fg #0a1006
 *   --t-1 #ecedf2, --t-2 #b8bdc9, --t-4 #74798a (WCAG AA bumpé)
 *
 * Posture athlète discipline : signature Robin Neon, mono-accent CTA lime.
 */
export function InvitationEmail({ inviteUrl, invitedByName, expiresInDays }: InvitationEmailProps) {
  const inviter = invitedByName?.trim() ? invitedByName.trim() : 'Eliot';

  return (
    <Html lang="fr">
      <Head>
        <title>Activer ton compte Fxmily</title>
      </Head>
      <Preview>Tu es invité·e à rejoindre Fxmily — la discipline avant le marché</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Brand mark */}
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily</span>
          </Section>

          <Text style={eyebrow}>COHORTE PRIVÉE · INVITATION</Text>

          <Heading style={heading}>Bienvenue.</Heading>

          <Text style={paragraph}>
            <strong style={strong}>{inviter}</strong> t&apos;a invité·e à rejoindre l&apos;espace de
            suivi comportemental réservé aux membres de la formation.
          </Text>

          <Text style={paragraph}>
            Fxmily mesure ton plan, ta discipline, ton mental — pas les bougies. Le seul journal qui
            ignore le marché.
          </Text>

          <Section style={ctaSection}>
            <Button href={inviteUrl} style={button}>
              Activer mon compte →
            </Button>
          </Section>

          <Text style={smallParagraph}>
            Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :
            <br />
            <Link href={inviteUrl} style={link}>
              {inviteUrl}
            </Link>
          </Text>

          <Hr style={hr} />

          {/* Discipline-first principles */}
          <Section style={principlesSection}>
            <Text style={principlesEyebrow}>CE QU&apos;ON MESURE ICI</Text>
            <table style={principlesTable} cellPadding={0} cellSpacing={0} role="presentation">
              <tbody>
                <tr>
                  <td style={principleCell}>
                    <Text style={principleText}>
                      <span style={principleDot}>·</span> Ton plan de trade et son adhérence
                    </Text>
                  </td>
                </tr>
                <tr>
                  <td style={principleCell}>
                    <Text style={principleText}>
                      <span style={principleDot}>·</span> Ta discipline post-clôture
                    </Text>
                  </td>
                </tr>
                <tr>
                  <td style={principleCell}>
                    <Text style={principleText}>
                      <span style={principleDot}>·</span> Ton mental check J+1
                    </Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            Ce lien expire dans {expiresInDays} jour{expiresInDays > 1 ? 's' : ''} et ne peut servir
            qu&apos;une seule fois. Si tu n&apos;as pas demandé cette invitation, tu peux ignorer
            cet email — aucun compte ne sera créé.
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

InvitationEmail.PreviewProps = {
  inviteUrl: 'https://app.fxmilyapp.com/onboarding/welcome?token=preview',
  invitedByName: 'Eliot',
  expiresInDays: 7,
} satisfies InvitationEmailProps;

export default InvitationEmail;

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
  borderRadius: 16, // --radius-card-lg
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
  border: '1px solid rgba(163, 230, 53, 0.42)', // --b-acc
  backgroundColor: 'rgba(163, 230, 53, 0.14)', // --acc-dim
  color: '#a3e635', // --acc
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

const strong: React.CSSProperties = {
  color: '#ecedf2',
  fontWeight: 600,
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
  backgroundColor: '#a3e635', // --acc lime
  color: '#0a1006', // --acc-fg
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '0.005em',
  textDecoration: 'none',
  padding: '14px 28px',
  borderRadius: 6, // --r-control
  display: 'inline-block',
  boxShadow:
    '0 1px 0 rgba(255, 255, 255, 0.18) inset, 0 0 0 1px rgba(163, 230, 53, 0.65), 0 8px 16px -4px rgba(163, 230, 53, 0.30)',
};

const link: React.CSSProperties = {
  color: '#a3e635', // --acc
  textDecoration: 'underline',
};

const hr: React.CSSProperties = {
  borderColor: 'rgba(120, 128, 150, 0.14)', // --b-default
  margin: '28px 0 20px 0',
};

const principlesSection: React.CSSProperties = {
  margin: '0 0 4px 0',
};

const principlesEyebrow: React.CSSProperties = {
  ...eyebrow,
  color: '#a3e635', // accent eyebrow
  margin: '0 0 10px 0',
};

const principlesTable: React.CSSProperties = {
  width: '100%',
};

const principleCell: React.CSSProperties = {
  paddingBottom: 4,
};

const principleText: React.CSSProperties = {
  color: '#b8bdc9',
  fontSize: 14,
  lineHeight: '20px',
  margin: 0,
};

const principleDot: React.CSSProperties = {
  color: '#a3e635',
  marginRight: 8,
  fontWeight: 700,
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
