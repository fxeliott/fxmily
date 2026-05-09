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

interface AnnotationReceivedEmailProps {
  /** Member's first name — falls back to "Trader" if missing. */
  recipientFirstName: string | null | undefined;
  /** Admin display name — falls back to "Eliot" (V1 sole admin). */
  adminName: string | null | undefined;
  /** Trade pair (eg "EURUSD") — shown in the headline so the email is scannable. */
  tradePair: string;
  /** Whether the annotation includes a media attachment (image at J4). */
  hasMedia: boolean;
  /** Direct link to /journal/[id] — clicking marks the annotation as seen. */
  tradeUrl: string;
}

/**
 * Email "tu as reçu une correction" — design-system v2 lime sur deep space.
 *
 * Email-safe inline hex (cf. invitation.tsx). Posture athlète/discipline :
 * la correction est un point d'amélioration, pas une critique. Le ton du
 * preview/title doit donner envie d'ouvrir, pas créer de l'anxiété.
 */
export function AnnotationReceivedEmail({
  recipientFirstName,
  adminName,
  tradePair,
  hasMedia,
  tradeUrl,
}: AnnotationReceivedEmailProps) {
  const recipient = recipientFirstName?.trim() ? recipientFirstName.trim() : 'Trader';
  const author = adminName?.trim() ? adminName.trim() : 'Eliot';

  return (
    <Html lang="fr">
      <Head>
        <title>Nouvelle correction sur {tradePair}</title>
      </Head>
      <Preview>
        {author} t&apos;a laissé une correction sur ton trade {tradePair}.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily</span>
          </Section>

          <Text style={eyebrow}>NOUVELLE CORRECTION · COACHING</Text>

          <Heading style={heading}>Salut {recipient},</Heading>

          <Text style={paragraph}>
            <strong style={strong}>{author}</strong> a laissé une correction sur ton trade{' '}
            <span style={pair}>{tradePair}</span>.
          </Text>

          <Text style={paragraph}>
            {hasMedia
              ? 'Texte + capture annotée à consulter directement dans ton journal.'
              : 'Texte à consulter directement dans ton journal.'}
          </Text>

          <Section style={ctaSection}>
            <Button href={tradeUrl} style={button}>
              Voir la correction →
            </Button>
          </Section>

          <Text style={smallParagraph}>
            Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :
            <br />
            <Link href={tradeUrl} style={link}>
              {tradeUrl}
            </Link>
          </Text>

          <Hr style={hr} />

          <Text style={footer}>
            Aucune analyse de marché — uniquement de l&apos;exécution et de la psychologie. La
            correction est marquée comme lue dès que tu ouvres le trade.
          </Text>

          <Text style={footerSign}>— L&apos;équipe Fxmily</Text>
        </Container>

        <Text style={legal}>
          Cohorte privée invitation-only. Tu peux désactiver les emails de correction dans tes
          préférences (J9). © 2026 Fxmily.
        </Text>
      </Body>
    </Html>
  );
}

AnnotationReceivedEmail.PreviewProps = {
  recipientFirstName: 'Sophie',
  adminName: 'Eliot',
  tradePair: 'EURUSD',
  hasMedia: true,
  tradeUrl: 'https://app.fxmilyapp.com/journal/clx0trade1',
} satisfies AnnotationReceivedEmailProps;

export default AnnotationReceivedEmail;

// ============================================================
// STYLES (email-safe inline, hex translated from OKLCH tokens)
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
  border: '1px solid rgba(163, 230, 53, 0.42)',
  backgroundColor: 'rgba(163, 230, 53, 0.14)',
  color: '#a3e635',
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
  color: '#a3e635',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  margin: '0 0 8px 0',
};

const heading: React.CSSProperties = {
  color: '#ecedf2',
  fontSize: 28,
  fontWeight: 700,
  letterSpacing: '-0.02em',
  lineHeight: '32px',
  margin: '0 0 16px 0',
};

const paragraph: React.CSSProperties = {
  color: '#b8bdc9',
  fontSize: 15,
  lineHeight: '23px',
  margin: '0 0 14px 0',
};

const strong: React.CSSProperties = {
  color: '#ecedf2',
  fontWeight: 600,
};

const pair: React.CSSProperties = {
  fontFamily:
    '"JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  color: '#ecedf2',
  fontWeight: 600,
  letterSpacing: '0.01em',
};

const smallParagraph: React.CSSProperties = {
  color: '#74798a',
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
  backgroundColor: '#a3e635',
  color: '#0a1006',
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '0.005em',
  textDecoration: 'none',
  padding: '14px 28px',
  borderRadius: 6,
  display: 'inline-block',
  boxShadow:
    '0 1px 0 rgba(255, 255, 255, 0.18) inset, 0 0 0 1px rgba(163, 230, 53, 0.65), 0 8px 16px -4px rgba(163, 230, 53, 0.30)',
};

const link: React.CSSProperties = {
  color: '#a3e635',
  textDecoration: 'underline',
};

const hr: React.CSSProperties = {
  borderColor: 'rgba(120, 128, 150, 0.14)',
  margin: '28px 0 20px 0',
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
  margin: '16px 0 0 0',
};

const legal: React.CSSProperties = {
  color: '#74798a',
  fontSize: 11,
  textAlign: 'center',
  margin: '20px 0 0 0',
  fontStyle: 'italic',
};
