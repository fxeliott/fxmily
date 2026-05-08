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

interface WeeklyDigestEmailProps {
  /** Display label of the member ("Sophie Martin", or email fallback). */
  memberLabel: string;
  /** Local-week period: "du 06 mai au 12 mai 2026". */
  weekStartLocal: string; // YYYY-MM-DD
  weekEndLocal: string; // YYYY-MM-DD
  /** Claude output. */
  summary: string;
  risks: string[];
  recommendations: string[];
  patterns: {
    emotionPerf?: string | undefined;
    sleepPerf?: string | undefined;
    sessionFocus?: string | undefined;
    disciplineTrend?: string | undefined;
  };
  /** Direct link to /admin/reports/[id]. */
  reportUrl: string;
  /** Model name (mock vs live shown in footer). */
  claudeModel: string;
  /** "0.012345" — for footer cost line. */
  costEur: string;
  /** True if this digest came from the deterministic mock client. */
  mocked: boolean;
}

/**
 * Weekly digest email — sent to Eliot (admin) every Sunday after the cron
 * generates the per-member reports (J8, SPEC §7.10).
 *
 * Posture athlète/discipline. The summary is structured (summary + risks +
 * recommendations + patterns) so Eliot can scan in 30 seconds and decide
 * whether to message the member.
 *
 * Email-safe inline hex (cf. `annotation-received.tsx` + `invitation.tsx`).
 */
export function WeeklyDigestEmail({
  memberLabel,
  weekStartLocal,
  weekEndLocal,
  summary,
  risks,
  recommendations,
  patterns,
  reportUrl,
  claudeModel,
  costEur,
  mocked,
}: WeeklyDigestEmailProps) {
  const period = formatPeriod(weekStartLocal, weekEndLocal);
  const patternEntries: Array<[string, string]> = [];
  if (patterns.emotionPerf) patternEntries.push(['Émotion × Performance', patterns.emotionPerf]);
  if (patterns.sleepPerf) patternEntries.push(['Sommeil × Performance', patterns.sleepPerf]);
  if (patterns.sessionFocus) patternEntries.push(['Sessions traitées', patterns.sessionFocus]);
  if (patterns.disciplineTrend)
    patternEntries.push(['Trajectoire discipline', patterns.disciplineTrend]);

  return (
    <Html lang="fr">
      <Head>
        <title>
          Rapport hebdo · {memberLabel} · {period}
        </title>
      </Head>
      <Preview>
        Rapport hebdo IA — {memberLabel} — {period}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily — Rapport admin</span>
          </Section>

          <Text style={eyebrow}>RAPPORT HEBDO IA · COMPORTEMENT</Text>
          <Heading style={heading}>{memberLabel}</Heading>
          <Text style={periodText}>{period}</Text>

          {mocked ? (
            <Section style={mockBanner}>
              <Text style={mockBannerText}>
                Mode mock (ANTHROPIC_API_KEY non configurée). Le contenu est déterministe :
                configure la clé pour activer Claude.
              </Text>
            </Section>
          ) : null}

          <Section style={blockSection}>
            <Text style={sectionLabel}>Synthèse</Text>
            <Text style={summaryText}>{summary}</Text>
          </Section>

          {risks.length > 0 ? (
            <Section style={blockSection}>
              <Text style={sectionLabel}>Risques à surveiller</Text>
              {risks.map((risk, idx) => (
                <Text key={`risk-${idx}`} style={listItem}>
                  <span style={bulletWarn}>·</span> {risk}
                </Text>
              ))}
            </Section>
          ) : null}

          <Section style={blockSection}>
            <Text style={sectionLabel}>Recommandations</Text>
            {recommendations.map((reco, idx) => (
              <Text key={`reco-${idx}`} style={listItem}>
                <span style={bulletAcc}>·</span> {reco}
              </Text>
            ))}
          </Section>

          {patternEntries.length > 0 ? (
            <Section style={blockSection}>
              <Text style={sectionLabel}>Patterns observés</Text>
              {patternEntries.map(([label, value], idx) => (
                <Text key={`pattern-${idx}`} style={patternRow}>
                  <span style={patternLabelStyle}>{label}</span>
                  <span style={patternValueStyle}>{value}</span>
                </Text>
              ))}
            </Section>
          ) : null}

          <Section style={ctaSection}>
            <Link href={reportUrl} style={cta}>
              Ouvrir le rapport complet →
            </Link>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            Aucun conseil de trade — uniquement comportement, exécution, psychologie (SPEC §2).
          </Text>
          <Text style={footerMeta}>
            Modèle : <span style={footerMono}>{claudeModel}</span> · coût :{' '}
            <span style={footerMono}>{Number(costEur).toFixed(4)} €</span>
          </Text>
        </Container>

        <Text style={legal}>
          Cohorte privée invitation-only. Rapport généré chaque dimanche 21:00 UTC. © 2026 Fxmily.
        </Text>
      </Body>
    </Html>
  );
}

WeeklyDigestEmail.PreviewProps = {
  memberLabel: 'Sophie Martin',
  weekStartLocal: '2026-05-04',
  weekEndLocal: '2026-05-10',
  summary:
    'Le membre a pris 8 trades cette semaine (winrate 50%) avec 75% de plan respecté. Streak de 6 jours, journal nourri. Tendance émotionnelle stable.',
  risks: [
    'Plan respecté à 60% sur les 3 derniers trades — drift à surveiller, à recouper avec les annotations admin.',
  ],
  recommendations: [
    'Encourager la journalisation post-trade les jours pertes — la tendance montre une fiabilité plus haute quand le journal est rempli.',
    "Envoyer la fiche Mark Douglas sur l'acceptation des pertes — alignement parfait avec la posture observée.",
  ],
  patterns: {
    emotionPerf: 'FOMO sur 2 trades / Calme sur 6 trades — winrate 0/2 vs 4/6. Signal cohérent.',
    sleepPerf: 'Sommeil < 6h sur 1 trade (perte). Échantillon trop petit pour conclure.',
    sessionFocus: '6 trades en session London, 2 en NY — bon focus sur la fenêtre habituelle.',
    disciplineTrend: 'Plan respect rate 75% (vs 65% semaine -1) — progression claire.',
  },
  reportUrl: 'https://app.fxmily.com/admin/reports/clx0report1',
  claudeModel: 'claude-sonnet-4-6',
  costEur: '0.014230',
  mocked: false,
} satisfies WeeklyDigestEmailProps;

export default WeeklyDigestEmail;

// ============================================================
// STYLES (email-safe inline hex)
// ============================================================

function formatPeriod(start: string, end: string): string {
  // YYYY-MM-DD → "06 mai au 12 mai 2026"
  const fmt = (s: string): { day: string; month: string; year: string } => {
    const [y, m, d] = s.split('-');
    const monthNames = [
      'janv.',
      'févr.',
      'mars',
      'avril',
      'mai',
      'juin',
      'juil.',
      'août',
      'sept.',
      'oct.',
      'nov.',
      'déc.',
    ];
    return {
      day: d ?? '',
      month: monthNames[Number(m ?? 1) - 1] ?? '',
      year: y ?? '',
    };
  };
  const s = fmt(start);
  const e = fmt(end);
  if (s.year === e.year && s.month === e.month) {
    return `du ${Number(s.day)} au ${Number(e.day)} ${e.month} ${e.year}`;
  }
  return `du ${Number(s.day)} ${s.month} au ${Number(e.day)} ${e.month} ${e.year}`;
}

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
  maxWidth: 600,
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
  margin: '0 0 6px 0',
};

const heading: React.CSSProperties = {
  color: '#ecedf2',
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: '-0.02em',
  lineHeight: '30px',
  margin: '0 0 4px 0',
};

const periodText: React.CSSProperties = {
  color: '#8c92a3',
  fontSize: 13,
  margin: '0 0 18px 0',
};

const mockBanner: React.CSSProperties = {
  backgroundColor: 'rgba(247, 196, 92, 0.10)',
  border: '1px solid rgba(247, 196, 92, 0.30)',
  borderRadius: 8,
  padding: '10px 14px',
  margin: '0 0 18px 0',
};

const mockBannerText: React.CSSProperties = {
  color: '#f7c45c',
  fontSize: 12,
  margin: 0,
  lineHeight: '18px',
};

const blockSection: React.CSSProperties = {
  margin: '0 0 22px 0',
};

const sectionLabel: React.CSSProperties = {
  color: '#a3e635',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  margin: '0 0 10px 0',
};

const summaryText: React.CSSProperties = {
  color: '#ecedf2',
  fontSize: 15,
  lineHeight: '23px',
  margin: 0,
};

const listItem: React.CSSProperties = {
  color: '#b8bdc9',
  fontSize: 14,
  lineHeight: '21px',
  margin: '0 0 6px 0',
};

const bulletAcc: React.CSSProperties = {
  color: '#a3e635',
  fontWeight: 700,
  marginRight: 8,
};

const bulletWarn: React.CSSProperties = {
  color: '#f7c45c',
  fontWeight: 700,
  marginRight: 8,
};

const patternRow: React.CSSProperties = {
  color: '#b8bdc9',
  fontSize: 13,
  lineHeight: '20px',
  margin: '0 0 8px 0',
};

const patternLabelStyle: React.CSSProperties = {
  color: '#74798a',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  display: 'block',
  marginBottom: 2,
};

const patternValueStyle: React.CSSProperties = {
  color: '#ecedf2',
  display: 'block',
};

const ctaSection: React.CSSProperties = {
  textAlign: 'center',
  margin: '24px 0 0 0',
};

const cta: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#a3e635',
  color: '#0a1006',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.005em',
  textDecoration: 'none',
  padding: '12px 22px',
  borderRadius: 6,
  boxShadow:
    '0 1px 0 rgba(255, 255, 255, 0.18) inset, 0 0 0 1px rgba(163, 230, 53, 0.65), 0 8px 16px -4px rgba(163, 230, 53, 0.30)',
};

const hr: React.CSSProperties = {
  borderColor: 'rgba(120, 128, 150, 0.14)',
  margin: '28px 0 16px 0',
};

const footer: React.CSSProperties = {
  color: '#8c92a3',
  fontSize: 12,
  lineHeight: '18px',
  margin: '0 0 6px 0',
};

const footerMeta: React.CSSProperties = {
  color: '#74798a',
  fontSize: 11,
  margin: '0',
};

const footerMono: React.CSSProperties = {
  fontFamily:
    '"JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  color: '#b8bdc9',
};

const legal: React.CSSProperties = {
  color: '#74798a',
  fontSize: 11,
  textAlign: 'center',
  margin: '20px 0 0 0',
  fontStyle: 'italic',
};
