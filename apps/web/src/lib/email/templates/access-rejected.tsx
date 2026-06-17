import {
  Body,
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

interface AccessRejectedEmailProps {
  firstName: string | null | undefined;
}

/**
 * Email "demande non retenue" Fxmily (§26.4 — parcours d'accès complet).
 *
 * Sent after the admin REJECTS a public `/rejoindre` access request. §26 du
 * brief Session 2 exige explicitement que « le membre reçoit alors un e-mail
 * d'acceptation OU de refus » — ce template ferme la moitié "refus" qui était
 * historiquement un refus silencieux (choix anti-énumération initial, levé sur
 * décision produit 2026-06-16 : conformité §26).
 *
 * Même palette email-safe inline que `access-approved.tsx` (DS v2 deep-space)
 * mais SANS CTA lime (aucune action côté demandeur) — ton respectueux, sobre,
 * sans faux espoir. Privacy §26 : AUCUNE donnée perso autre que le prénom (en
 * salutation) et l'adresse de contact `fxeliott@fxmily.fr`. Aucun lien, aucun
 * token, aucune raison de refus détaillée (data minimisation).
 */
export function AccessRejectedEmail({ firstName }: AccessRejectedEmailProps) {
  const name = firstName?.trim() ? firstName.trim() : null;

  return (
    <Html lang="fr">
      <Head>
        <title>Ta demande Fxmily</title>
      </Head>
      <Preview>Suite à ta demande d&apos;accès à Fxmily.</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Brand mark */}
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily</span>
          </Section>

          <Text style={eyebrow}>COHORTE PRIVÉE · DEMANDE D&apos;ACCÈS</Text>

          <Heading style={heading}>Ta demande n&apos;a pas été retenue.</Heading>

          <Text style={paragraph}>
            {name ? (
              <>
                <strong style={strong}>{name}</strong>, merci d&apos;avoir fait une demande
                d&apos;accès à Fxmily.
              </>
            ) : (
              <>Merci d&apos;avoir fait une demande d&apos;accès à Fxmily.</>
            )}{' '}
            Après examen, nous ne pouvons pas y donner suite pour le moment.
          </Text>

          <Text style={paragraph}>
            Ce n&apos;est pas un jugement sur ton potentiel : la cohorte est privée et le nombre de
            places est volontairement limité pour garder un suivi de qualité.
          </Text>

          <Hr style={hr} />

          <Text style={footer}>
            Une question ? Écris à{' '}
            <Link href="mailto:fxeliott@fxmily.fr" style={link}>
              fxeliott@fxmily.fr
            </Link>
            .
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

AccessRejectedEmail.PreviewProps = {
  firstName: 'Eliott',
} satisfies AccessRejectedEmailProps;

export default AccessRejectedEmail;

// ============================================================
// STYLES (email-safe inline, hex translated from OKLCH tokens)
// Mirror de access-approved.tsx — sans les styles du CTA/principles.
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

const strong: React.CSSProperties = {
  color: '#ecedf2',
  fontWeight: 600,
};

const hr: React.CSSProperties = {
  borderColor: 'rgba(120, 128, 150, 0.14)', // --b-default
  margin: '28px 0 20px 0',
};

const link: React.CSSProperties = {
  color: '#a3e635', // --acc
  textDecoration: 'underline',
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
