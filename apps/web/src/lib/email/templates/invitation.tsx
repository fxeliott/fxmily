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

export function InvitationEmail({ inviteUrl, invitedByName, expiresInDays }: InvitationEmailProps) {
  const inviter = invitedByName?.trim() ? invitedByName.trim() : 'Eliot';

  return (
    <Html lang="fr">
      <Head>
        <title>Activer ton compte Fxmily</title>
      </Head>
      <Preview>Tu es invité·e à rejoindre Fxmily</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Bienvenue sur Fxmily</Heading>

          <Text style={paragraph}>
            {inviter} t&apos;a invité·e à rejoindre l&apos;espace de suivi comportemental réservé
            aux membres de la formation.
          </Text>

          <Text style={paragraph}>
            Active ton compte en cliquant sur le bouton ci-dessous. Tu vas choisir ton mot de passe
            et compléter ton profil en moins d&apos;une minute.
          </Text>

          <Section style={ctaSection}>
            <Button href={inviteUrl} style={button}>
              Activer mon compte
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

          <Text style={footer}>
            Ce lien expire dans {expiresInDays} jour{expiresInDays > 1 ? 's' : ''}. Si tu n&apos;as
            pas demandé cette invitation, tu peux ignorer cet email — aucun compte ne sera créé.
          </Text>

          <Text style={footer}>— L&apos;équipe Fxmily</Text>
        </Container>
      </Body>
    </Html>
  );
}

InvitationEmail.PreviewProps = {
  inviteUrl: 'https://app.fxmily.com/onboarding/welcome?token=preview',
  invitedByName: 'Eliot',
  expiresInDays: 7,
} satisfies InvitationEmailProps;

export default InvitationEmail;

const body: React.CSSProperties = {
  backgroundColor: '#0a0e1a',
  color: '#e8ecf4',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif',
  margin: 0,
  padding: '32px 16px',
};

const container: React.CSSProperties = {
  backgroundColor: '#101826',
  borderRadius: 12,
  padding: '32px 24px',
  maxWidth: 520,
  margin: '0 auto',
};

const heading: React.CSSProperties = {
  color: '#e8ecf4',
  fontSize: 24,
  fontWeight: 700,
  margin: '0 0 24px 0',
};

const paragraph: React.CSSProperties = {
  color: '#cbd5e1',
  fontSize: 15,
  lineHeight: '22px',
  margin: '0 0 16px 0',
};

const smallParagraph: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 13,
  lineHeight: '20px',
  margin: '24px 0 0 0',
  wordBreak: 'break-all',
};

const ctaSection: React.CSSProperties = {
  textAlign: 'center',
  margin: '32px 0',
};

const button: React.CSSProperties = {
  backgroundColor: '#2563eb',
  color: '#ffffff',
  fontSize: 15,
  fontWeight: 600,
  textDecoration: 'none',
  padding: '12px 24px',
  borderRadius: 8,
  display: 'inline-block',
};

const link: React.CSSProperties = {
  color: '#3b82f6',
  textDecoration: 'underline',
};

const hr: React.CSSProperties = {
  borderColor: 'rgba(99, 102, 241, 0.15)',
  margin: '32px 0 16px 0',
};

const footer: React.CSSProperties = {
  // #94a3b8 mirrors web `--muted`, which was bumped from #64748b for WCAG AA.
  // On the email container (#101826), #64748b → 2.61:1 (fails AA),
  // #94a3b8 → 6.04:1 (passes AA).
  color: '#94a3b8',
  fontSize: 12,
  lineHeight: '18px',
  margin: '0 0 8px 0',
};
