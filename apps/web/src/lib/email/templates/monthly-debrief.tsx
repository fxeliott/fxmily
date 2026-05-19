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

import type { MonthlyDebriefPatterns } from '@/lib/schemas/monthly-debrief';

interface MonthlyDebriefEmailProps {
  /** Member first name — falls back to "Trader" if missing. */
  recipientFirstName: string | null | undefined;
  /** Civil-month label, e.g. "Mai 2026". */
  monthLabel: string;
  /** Claude output (already Zod-validated + persisted). */
  progressionNarrative: string;
  summaryReal: string;
  summaryTraining: string;
  risks: string[];
  recommendations: string[];
  patterns: MonthlyDebriefPatterns;
  /** Direct link to the member page `/debrief-mensuel?id=[id]`. */
  debriefUrl: string;
  /** Model name (drives the EU AI Act disclaimer wording). */
  claudeModel: string;
}

/**
 * V1.4 §25 — Monthly AI debrief email, sent to the MEMBER (SPEC §25.2 — push
 * + member email; NO admin monthly email by design).
 *
 * Carbon of `weekly-digest.tsx` (email-safe inline hex, DS-v2 lime on deep
 * space) but member-facing and dual-section:
 *   - progression narrative (the V1.4 value-add vs the weekly digest)
 *   - Trading réel section — lime (legitimate real-P&L coaching, the product)
 *   - Entraînement section — **cyan #22d3ee accent (§21.7 boundary stays
 *     visible)**, §21.5-safe text (effort/regularity only, never backtest P&L)
 *   - EU AI Act 50(1) disclaimer banner (mirror weekly aiBanner, mandatory
 *     before 2 août 2026, Article 99(4) penalty €15M / 3%)
 *
 * Posture Mark Douglas / anti Black-Hat: calm, factual, no XP/streak/fanfare,
 * no trade advice (SPEC §2).
 */
export function MonthlyDebriefEmail({
  recipientFirstName,
  monthLabel,
  progressionNarrative,
  summaryReal,
  summaryTraining,
  risks,
  recommendations,
  patterns,
  debriefUrl,
  claudeModel,
}: MonthlyDebriefEmailProps) {
  const recipient = recipientFirstName?.trim() ? recipientFirstName.trim() : 'Trader';
  const patternEntries: Array<[string, string]> = [];
  if (patterns.monthOverMonth)
    patternEntries.push(['Progression mois sur mois', patterns.monthOverMonth]);
  if (patterns.realTrend) patternEntries.push(['Tendance trading réel', patterns.realTrend]);
  if (patterns.trainingRhythm)
    patternEntries.push(['Rythme d’entraînement', patterns.trainingRhythm]);
  if (patterns.disciplineTrend)
    patternEntries.push(['Trajectoire discipline', patterns.disciplineTrend]);

  return (
    <Html lang="fr">
      <Head>
        <title>Ton débrief mensuel · {monthLabel}</title>
      </Head>
      <Preview>Ta synthèse du mois — {monthLabel}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <span style={logoBadge}>F</span>
            <span style={brandName}>Fxmily — Débrief mensuel</span>
          </Section>

          <Text style={eyebrow}>DÉBRIEF MENSUEL · {monthLabel.toUpperCase()}</Text>
          <Heading style={heading}>Salut {recipient},</Heading>
          <Text style={periodText}>
            Voici ta synthèse du mois écoulé — un moment pour prendre du recul, à ton rythme.
          </Text>

          {/* EU AI Act 50(1) chatbot transparency disclaimer (mandatoire avant
              2 août 2026, pénalité €15M / 3% Art. 99(4)). Inline HTML version
              of `AIGeneratedBanner` — React Email renders email-safe HTML. */}
          <Section style={aiBanner}>
            <Text style={aiBannerText}>
              Cette synthèse est générée par une intelligence artificielle (
              {claudeModel === 'claude-code-local'
                ? 'Claude — subscription locale'
                : `Claude ${claudeModel}`}
              , Anthropic). Elle ne remplace ni un coaching humain, ni un avis médical, ni un
              conseil en investissement personnalisé.
            </Text>
          </Section>

          <Section style={blockSection}>
            <Text style={sectionLabel}>Progression</Text>
            <Text style={summaryText}>{progressionNarrative}</Text>
          </Section>

          <Section style={blockSection}>
            <Text style={sectionLabel}>Trading réel</Text>
            <Text style={summaryText}>{summaryReal}</Text>
          </Section>

          {/* §21.7 — the entraînement section keeps the cyan boundary visible
              even in a mixed debrief. §21.5-safe: effort/regularity only, the
              snapshot fed to the AI carried no backtest P&L. */}
          <Section style={trainingSection}>
            <Text style={sectionLabelCyan}>Entraînement</Text>
            <Text style={summaryText}>{summaryTraining}</Text>
            <Text style={trainingNote}>
              Régularité et pratique uniquement — pas de P&amp;L, pas d’analyse de marché. Ton
              entraînement reste isolé de ton edge réel.
            </Text>
          </Section>

          {risks.length > 0 ? (
            <Section style={blockSection}>
              <Text style={sectionLabel}>Points de vigilance</Text>
              {risks.map((risk, idx) => (
                <Text key={`risk-${idx}`} style={listItem}>
                  <span style={bulletWarn}>·</span> {risk}
                </Text>
              ))}
            </Section>
          ) : null}

          <Section style={blockSection}>
            <Text style={sectionLabel}>Pistes pour le mois à venir</Text>
            {recommendations.map((reco, idx) => (
              <Text key={`reco-${idx}`} style={listItem}>
                <span style={bulletAcc}>·</span> {reco}
              </Text>
            ))}
          </Section>

          {patternEntries.length > 0 ? (
            <Section style={blockSection}>
              <Text style={sectionLabel}>Tendances observées</Text>
              {patternEntries.map(([label, value], idx) => (
                <Text key={`pattern-${idx}`} style={patternRow}>
                  <span style={patternLabelStyle}>{label}</span>
                  <span style={patternValueStyle}>{value}</span>
                </Text>
              ))}
            </Section>
          ) : null}

          <Section style={ctaSection}>
            <Link href={debriefUrl} style={cta}>
              Ouvrir mon débrief →
            </Link>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            Aucun conseil de trade — uniquement progression, comportement, exécution, psychologie
            (SPEC §2).
          </Text>
        </Container>

        <Text style={legal}>
          Cohorte privée invitation-only. Synthèse générée au début de chaque mois. © 2026 Fxmily.
        </Text>
      </Body>
    </Html>
  );
}

MonthlyDebriefEmail.PreviewProps = {
  recipientFirstName: 'Sophie',
  monthLabel: 'Mai 2026',
  progressionNarrative:
    'Sur deux mois, ta discipline passe de 71% à 84% de plan respecté. Le journal post-trade est devenu plus régulier, et la tendance émotionnelle se stabilise sur les jours de perte.',
  summaryReal:
    'Mois à 22 trades réels (winrate 50%), plan respecté à 80%. Le R moyen reste positif malgré 3 pertes consécutives mi-mois absorbées sans tilt visible.',
  summaryTraining:
    'Pratique d’entraînement régulière : 14 backtests sur 9 jours distincts, dernier il y a 2 jours. La régularité s’installe — c’est l’effort qui compte ici, pas le résultat.',
  risks: [
    'Plan respecté à 60% sur la dernière semaine du mois — léger relâchement à surveiller en début de mois prochain.',
  ],
  recommendations: [
    'Garder le rythme de journalisation post-trade les jours de perte — la régularité du mois a payé.',
    'Continuer l’entraînement à cadence constante plutôt qu’en rafale — la pratique espacée ancre mieux.',
  ],
  patterns: {
    monthOverMonth: 'Discipline 71% → 84% sur 2 mois.',
    realTrend: 'FOMO -0.4R moyen sur 4 trades réels (vs 9 calmes à +0.6R).',
    trainingRhythm: '14 backtests / 9 jours distincts — cadence régulière.',
    disciplineTrend: 'Plan respect 80% (vs 68% mois -1).',
  },
  debriefUrl: 'https://app.fxmilyapp.com/debrief-mensuel?id=clx0debrief1',
  claudeModel: 'claude-code-local',
} satisfies MonthlyDebriefEmailProps;

export default MonthlyDebriefEmail;

// ============================================================
// STYLES (email-safe inline hex — carbon `weekly-digest.tsx`)
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

// EU AI Act 50(1) chatbot transparency disclaimer banner (indigo, mirror
// `weekly-digest.tsx` aiBanner).
const aiBanner: React.CSSProperties = {
  backgroundColor: 'rgba(99, 102, 241, 0.08)',
  border: '1px solid rgba(99, 102, 241, 0.25)',
  borderLeft: '4px solid #6366f1',
  borderRadius: 6,
  padding: '10px 14px',
  margin: '0 0 18px 0',
};

const aiBannerText: React.CSSProperties = {
  color: '#c7c8d4',
  fontSize: 12,
  margin: 0,
  lineHeight: '18px',
};

const blockSection: React.CSSProperties = {
  margin: '0 0 22px 0',
};

// §21.7 — entraînement section framed cyan (#22d3ee = DS `--cy`) so the
// §21 boundary stays visible even inside a mixed real/training debrief.
const trainingSection: React.CSSProperties = {
  backgroundColor: 'rgba(34, 211, 238, 0.07)',
  border: '1px solid rgba(34, 211, 238, 0.22)',
  borderLeft: '4px solid #22d3ee',
  borderRadius: 8,
  padding: '14px 16px',
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

const sectionLabelCyan: React.CSSProperties = {
  color: '#22d3ee',
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

const trainingNote: React.CSSProperties = {
  color: '#8c92a3',
  fontSize: 12,
  lineHeight: '18px',
  margin: '10px 0 0 0',
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

const legal: React.CSSProperties = {
  color: '#74798a',
  fontSize: 11,
  textAlign: 'center',
  margin: '20px 0 0 0',
  fontStyle: 'italic',
};
