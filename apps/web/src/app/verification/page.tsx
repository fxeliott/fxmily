import { ArrowLeft, ScanSearch, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { AccountCreateForm } from '@/components/verification/account-create-form';
import { ConstancyObjectiveBridge } from '@/components/verification/constancy-objective-bridge';
import { ConstancyScoreCard } from '@/components/verification/constancy-score-card';
import { ConstancyTrend } from '@/components/verification/constancy-trend';
import { DeleteProofButton } from '@/components/verification/delete-proof-button';
import { DiscrepancyReasonForm } from '@/components/verification/discrepancy-reason-form';
import { DriftAlertsCard } from '@/components/verification/drift-alerts-card';
import { ProofUploader } from '@/components/verification/proof-uploader';
import { RealityVsDeclared } from '@/components/verification/reality-vs-declared';
import { ScoreEventsHistory } from '@/components/verification/score-events-history';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { getProcessObjectives } from '@/lib/objectives/service';
import { listRecentAlertsForMember } from '@/lib/verification/alerts';
import {
  getLatestConstancyScore,
  listRecentConstancyScores,
  listRecentScoreEvents,
} from '@/lib/verification/constancy';
import { getVerificationOverview, listDiscrepancies } from '@/lib/verification/service';

/**
 * S3 — `/verification` member surface (SPEC §33, Vérification & Honnêteté
 * radicale).
 *
 * Posture §33.2 (anti Black-Hat, BLOQUANT) :
 *   - ferme sur les faits, jamais punitif — pas de rouge honte, pas de streak ;
 *   - copy honnête §33.6 : « confronté à l'historique fourni », JAMAIS
 *     « vérifié à 100 % » (un screenshot reste falsifiable, la forensique
 *     absolue = API broker V3) ;
 *   - le mensonge est un signal psychologique à travailler (Mark Douglas),
 *     pas un crime à sanctionner.
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Vérification' };

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Paris',
});

const OCR_STATUS_META = {
  pending: { label: 'En attente d’analyse', tone: 'warn' as const },
  done: { label: 'Analysée', tone: 'ok' as const },
  failed: { label: 'Lecture impossible', tone: 'mute' as const },
};

const ACCOUNT_TYPE_LABELS = {
  prop_firm: 'Prop firm',
  personal: 'Compte perso',
};

/**
 * DoD §33 enrichment — « badge de niveau de confiance/cohérence par compte ».
 * `confidence` is the vision detection confidence (0-1) for AI-detected
 * accounts. Surfaced with an HONEST qualitative label (never a raw %, never a
 * red « faible ») — posture §33.2 : informer, jamais accabler.
 */
function accountConfidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'Cohérence élevée';
  if (confidence >= 0.5) return 'Cohérence correcte';
  return 'À confirmer';
}

/** Calm, factual labels — never punitive (§33.2). */
const DISCREPANCY_META: Record<
  | 'missing_declared'
  | 'false_declared'
  | 'mismatch'
  | 'unfilled_no_reason'
  | 'meeting_missed_no_reason'
  | 'tracking_skipped_no_reason',
  { label: string; description: string }
> = {
  missing_declared: {
    label: 'Position réelle non déclarée',
    description: 'Une position de ton historique MT5 n’apparaît pas dans ton journal.',
  },
  false_declared: {
    label: 'Trade déclaré sans contrepartie',
    description:
      'Un trade de ton journal n’a pas de trace dans ton historique fourni, alors que la période est couverte.',
  },
  mismatch: {
    label: 'Écart de taille',
    description: 'Le trade et la position correspondent, mais les volumes divergent.',
  },
  unfilled_no_reason: {
    label: 'Journée sans suivi',
    description: 'Aucun check-in ce jour-là, sans motif pour l’instant.',
  },
  meeting_missed_no_reason: {
    label: 'Réunion manquée',
    description:
      'Une réunion programmée n’a pas été suivie (ni en direct ni en replay) dans le délai, sans motif. Donne-en un s’il y a lieu.',
  },
  tracking_skipped_no_reason: {
    label: 'Outil de suivi laissé de côté',
    description:
      'Un outil de suivi attendu n’a pas été rempli dans le délai, sans motif. Donne-en un s’il y a lieu.',
  },
};

export default async function VerificationPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  const timezone = session.user.timezone || 'Europe/Paris';
  const [overview, constancy, constancyHistory, discrepancies, scoreEvents, alerts, objectives] =
    await Promise.all([
      getVerificationOverview(session.user.id),
      getLatestConstancyScore(session.user.id),
      listRecentConstancyScores(session.user.id),
      listDiscrepancies(session.user.id),
      listRecentScoreEvents(session.user.id),
      listRecentAlertsForMember(session.user.id),
      // S4 (CONTEXTE « Scoring ») — relie le score de constance à l'objectif du
      // membre (cause → effet → prochain pas). Même lecture que le hub (DRY),
      // dérivée des signaux déjà calculés (0 nouvelle table). Lu en parallèle.
      getProcessObjectives(session.user.id, timezone),
    ]);
  const openDiscrepancies = discrepancies.filter((d) => d.status === 'open');
  const handledDiscrepancies = discrepancies.filter((d) => d.status !== 'open');

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* DS-v3 — ambient mesh + drifting orbs, tone CYAN : cohérent avec les deux
          graphiques cyan existants (ConstancyScoreCard / ConstancyTrend) et la
          posture §33.2 « miroir, pas sanction » (jamais de rouge punitif). */}
      <DashboardAmbient tone="cyan" />
      <div className="relative mx-auto flex w-full max-w-[var(--w-app)] flex-1 flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12">
        <header className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            Tableau de bord
          </Link>
          {/* S19 — hero glass carbone (cohérent PatternsHero / GuideHero) : ferme
              l'asymétrie du cluster (seule page sans panel glass). Tone CYAN
              (jamais d'accent CTA ici, posture miroir §33.2). Le récap chiffré à
              droite reste CALME — il réutilise overview/constancy DÉJÀ fetchés
              (0 query ajoutée) et ne montre jamais de rouge. */}
          <Card
            primary
            glass
            edge={false}
            className="dash-hero relative overflow-hidden p-6 backdrop-blur-[16px] backdrop-saturate-150 lg:p-7"
          >
            <div className="relative grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-center lg:gap-8">
              <div className="flex flex-col gap-2">
                <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  Vérification
                </span>
                <h1
                  className="f-display h-rise leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)]"
                  style={{
                    fontFeatureSettings: '"ss01" 1',
                    fontSize: 'clamp(1.75rem, 1.45rem + 1.3vw, 2.25rem)',
                  }}
                >
                  Ta réalité de trading
                </h1>
                <p className="t-lead max-w-[58ch]">
                  Ici, ton trading déclaré est mis en face de ton historique MT5 réel. Pas pour te
                  juger — pour t&apos;aider à te voir tel que tu es, et progresser à partir de là.
                  Ce qui est confronté, c&apos;est l&apos;historique que tu fournis : jamais tes
                  analyses, jamais de conseil de marché.
                </p>
              </div>

              {/* Récap chiffré CALME : score de constance + écarts à regarder +
                  preuves. tone cyan/neutre, 0 rouge (anti Black-Hat §33.2). */}
              <dl className="grid grid-cols-3 gap-2.5 lg:grid-cols-1">
                <div className="rounded-card flex flex-col gap-0.5 border border-[var(--cy-edge)] bg-[var(--bg-1)] p-3">
                  <dt className="t-cap text-[var(--t-4)]">Constance</dt>
                  <dd className="f-mono text-[20px] leading-none font-bold text-[var(--cy)] tabular-nums">
                    {constancy ? Math.round(constancy.value) : '—'}
                    <span className="text-[12px] font-normal text-[var(--t-4)]">/100</span>
                  </dd>
                </div>
                <div className="rounded-card flex flex-col gap-0.5 border border-[var(--b-default)] bg-[var(--bg-1)] p-3">
                  <dt className="t-cap text-[var(--t-4)]">À regarder</dt>
                  <dd className="f-mono text-[20px] leading-none font-bold text-[var(--t-1)] tabular-nums">
                    {openDiscrepancies.length}
                    <span className="text-[12px] font-normal text-[var(--t-4)]">
                      {openDiscrepancies.length > 1 ? ' écarts' : ' écart'}
                    </span>
                  </dd>
                </div>
                <div className="rounded-card flex flex-col gap-0.5 border border-[var(--b-default)] bg-[var(--bg-1)] p-3">
                  <dt className="t-cap text-[var(--t-4)]">Preuves</dt>
                  <dd className="f-mono text-[20px] leading-none font-bold text-[var(--t-1)] tabular-nums">
                    {overview.proofs.length}
                    <span className="text-[12px] font-normal text-[var(--t-4)]">
                      {overview.proofs.length > 1 ? ' fournies' : ' fournie'}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          </Card>
        </header>

        {/* Score de constance — au-dessus du fold, visible immédiatement (pas de
            wow-reveal : le score est l'info pivot, jamais retardé). */}
        <section className="flex flex-col gap-3" aria-labelledby="constancy-heading">
          <h2 id="constancy-heading" className="t-h2 text-[var(--t-1)]">
            Ta constance
          </h2>
          {/* On desktop, the score and its trajectory sit side-by-side so the
              section fills the width instead of stacking in a centred column. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
            <ConstancyScoreCard score={constancy} />
            {/* S4 — trajectoire de constance (brief §29 « voir l'évolution ») : ferme
                l'asymétrie avec les scores comportementaux qui ont déjà une courbe.
                Rendu seulement à partir de 2 semaines suivies (sinon null). */}
            <ConstancyTrend history={constancyHistory} />
          </div>
          {/* S4 — « le score reste explicable au membre » (promesse du schéma
              ScoreEvent) : les derniers événements, excusés neutralisés. */}
          <ScoreEventsHistory events={scoreEvents} />
          {/* S4 (CONTEXTE « Scoring ») — relie le score à l'objectif personnel :
              cause (ta constance) → effet (le levier qu'elle nourrit) → prochain
              pas (/objectifs). Rend null sans score ou sans objectif. */}
          <ConstancyObjectiveBridge
            score={constancy}
            focus={objectives.focus}
            coachingAxis={objectives.coachingAxis}
          />
        </section>

        {/* Écarts détectés — wow-reveal : fade+rise au scroll (progressive
            enhancement, opacity:1 baseline sans view(), neutralisé reduced-motion). */}
        <section className="wow-reveal flex flex-col gap-3" aria-labelledby="discrepancies-heading">
          <h2 id="discrepancies-heading" className="t-h2 text-[var(--t-1)]">
            Tes écarts
          </h2>
          {discrepancies.length === 0 ? (
            <p className="t-body max-w-prose text-[var(--t-3)]">
              Aucun écart détecté pour l&apos;instant entre ton déclaré et ta réalité. Continue
              comme ça — c&apos;est la régularité qui compte.
            </p>
          ) : (
            <>
              <p className="t-body max-w-prose leading-[1.6] text-[var(--t-2)]">
                Un écart n&apos;est pas une faute : c&apos;est une information. S&apos;il y a un
                motif (maladie, coupure, semaine off), donne-le — un oubli expliqué n&apos;est pas
                de l&apos;indiscipline.
              </p>
              <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
                {[...openDiscrepancies, ...handledDiscrepancies].map((d) => {
                  const meta = DISCREPANCY_META[d.type];
                  return (
                    <li key={d.id}>
                      {/* S18 — hover glow cool (acc) + liseré cool décoratif. Posture
                          anti-punitive §33.2 : JAMAIS de rouge, le halo reste neutre. */}
                      <Card className="wow-hover-glow group relative flex flex-col gap-2 p-4">
                        <span
                          aria-hidden
                          className="pointer-events-none absolute top-0 right-3 left-3 z-10 h-px opacity-70 transition-opacity duration-200 group-hover:opacity-100"
                          style={{
                            background:
                              'linear-gradient(90deg, transparent 0%, var(--cy-edge) 50%, transparent 100%)',
                          }}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold text-[var(--t-1)]">
                            {meta.label}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="t-cap text-[var(--t-4)]">
                              {DATE_FMT.format(d.detectedAt)}
                            </span>
                            {d.memberReason !== null ? (
                              <Pill tone="cy">Motif donné</Pill>
                            ) : d.status === 'open' ? (
                              <Pill tone="warn" dot>
                                À regarder
                              </Pill>
                            ) : (
                              <Pill tone="mute">Pris en compte</Pill>
                            )}
                          </span>
                        </div>
                        <p className="t-body leading-[1.5] text-[var(--t-3)]">
                          {d.reasoning ?? meta.description}
                        </p>
                        {/* « Réalité vs Déclaré » face-à-face (DoD §33) : les deux
                            côtés posés ligne par ligne. Rendu seulement quand l'écart
                            porte un côté trade (mismatch / position non déclarée /
                            trade sans contrepartie) ; les oublis de rituel n'en ont
                            pas et le composant renvoie null. */}
                        <RealityVsDeclared
                          declared={d.declared}
                          reality={d.reality}
                          type={d.type}
                        />
                        {d.memberReason !== null ? (
                          <p className="t-cap text-[var(--t-4)]">Ton motif : {d.memberReason}</p>
                        ) : (
                          <DiscrepancyReasonForm discrepancyId={d.id} />
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ul>
              {/* S4 — pont écart → travail psychologique (§26 « lien partenaire »).
                  Quand un écart se répète, une fiche Mark Douglas est livrée dans la
                  bibliothèque ; ce lien calme (anti Black-Hat §33.2) la rend
                  découvrable depuis l'endroit même où le membre voit ses écarts. */}
              <Link
                href="/library/inbox"
                className="rounded-card inline-flex min-h-[24px] items-center gap-1.5 self-start py-1 text-[12px] text-[var(--t-3)] underline-offset-2 transition-colors hover:text-[var(--t-1)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              >
                Quand un écart se répète, une fiche choisie pour toi t&apos;attend dans ta
                bibliothèque
                <ArrowLeft className="h-3.5 w-3.5 rotate-180" strokeWidth={1.75} aria-hidden />
              </Link>
            </>
          )}
        </section>

        {/* Alertes de dérive — wow-reveal. Couche au-dessus des écarts : quand un
            même type d'écart se répète au-delà de son seuil, une fiche Mark Douglas
            est préparée. Lecture seule, posture miroir §33.2 (jamais de rouge). */}
        <section className="wow-reveal flex flex-col gap-3" aria-labelledby="alerts-heading">
          <h2 id="alerts-heading" className="t-h2 text-[var(--t-1)]">
            Tes alertes de dérive
          </h2>
          <DriftAlertsCard alerts={alerts} />
        </section>

        {/* Comptes broker — wow-reveal */}
        <section className="wow-reveal flex flex-col gap-3" aria-labelledby="accounts-heading">
          <h2 id="accounts-heading" className="t-h2 text-[var(--t-1)]">
            Tes comptes
          </h2>
          {overview.accounts.length === 0 ? (
            <p className="t-body max-w-prose text-[var(--t-3)]">
              Déclare chacun de tes comptes — prop firm et perso. C&apos;est la base du suivi : un
              compte non déclaré finit toujours par se voir dans les écarts.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {overview.accounts.map((account) => (
              <Card
                key={account.id}
                className="wow-hover-glow flex flex-wrap items-center gap-3 p-4"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]">
                  <ShieldCheck className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[14px] font-semibold text-[var(--t-1)]">
                    {account.label}
                  </span>
                  <span className="t-cap text-[var(--t-4)]">
                    {ACCOUNT_TYPE_LABELS[account.type]}
                    {account.brokerName ? ` · ${account.brokerName}` : ''}
                    {` · ${account.proofsCount} preuve${account.proofsCount > 1 ? 's' : ''}`}
                    {account.positionsCount > 0
                      ? ` · ${account.positionsCount} position${account.positionsCount > 1 ? 's' : ''} lue${account.positionsCount > 1 ? 's' : ''}`
                      : ''}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {account.detectedByAI ? (
                    <Pill tone="cy">Détecté par l&apos;analyse</Pill>
                  ) : (
                    <Pill tone="mute">Déclaré</Pill>
                  )}
                  {account.confidence !== null ? (
                    <Pill tone="cy">{accountConfidenceLabel(account.confidence)}</Pill>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
          <Card className="flex w-full max-w-xl flex-col gap-3 p-4">
            <span className="t-h3 text-[var(--t-1)]">Déclarer un compte</span>
            <AccountCreateForm />
          </Card>
        </section>

        {/* Preuves MT5 — wow-reveal */}
        <section className="wow-reveal flex flex-col gap-3" aria-labelledby="proofs-heading">
          <h2 id="proofs-heading" className="t-h2 text-[var(--t-1)]">
            Tes preuves MT5
          </h2>
          <p className="t-body max-w-prose leading-[1.6] text-[var(--t-2)]">
            Téléverse une capture de l&apos;onglet « Historique » de MT5 pour{' '}
            <strong className="font-semibold text-[var(--t-1)]">chacun</strong> de tes comptes.
            L&apos;analyse lit les positions affichées et les confronte à ton journal. Une capture
            reste une capture — c&apos;est la régularité de tes preuves qui construit la confiance.
          </p>
          <Card className="flex w-full max-w-xl flex-col gap-3 p-4">
            <ProofUploader
              accounts={overview.accounts.map((a) => ({ id: a.id, label: a.label }))}
            />
          </Card>

          {overview.proofs.length > 0 ? (
            <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
              {overview.proofs.map((proof) => {
                const statusMeta = OCR_STATUS_META[proof.ocrStatus];
                const account = proof.brokerAccountId
                  ? overview.accounts.find((a) => a.id === proof.brokerAccountId)
                  : undefined;
                return (
                  <li key={proof.id}>
                    <Card className="wow-hover-glow flex flex-wrap items-center gap-3 p-4">
                      <a
                        href={proof.readUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={proof.readUrl}
                          alt="Capture d'historique MT5"
                          loading="lazy"
                          className="rounded-card h-16 w-24 border border-[var(--b-default)] object-cover"
                        />
                      </a>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="t-cap text-[var(--t-3)]">
                          {DATE_FMT.format(proof.uploadedAt)}
                          {account ? ` · ${account.label}` : ' · Sans compte rattaché'}
                          {proof.extractedPositionsCount > 0
                            ? ` · ${proof.extractedPositionsCount} position${proof.extractedPositionsCount > 1 ? 's' : ''} lue${proof.extractedPositionsCount > 1 ? 's' : ''}`
                            : ''}
                        </span>
                        <span>
                          <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>
                        </span>
                        {/* Empreinte SHA-256 (DoD §33 « horodatage ET empreinte,
                            audit trail inaltérable ») : trace de non-altération
                            posée à côté de l'horodatage. Tronquée à l'écran, hash
                            complet au survol. */}
                        <span
                          className="f-mono t-cap truncate text-[var(--t-4)]"
                          title={`Empreinte SHA-256 : ${proof.fileHash}`}
                        >
                          Empreinte {proof.fileHash.slice(0, 10)}…
                        </span>
                      </div>
                      <DeleteProofButton proofId={proof.id} />
                    </Card>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-card border border-dashed border-[var(--b-default)] bg-[var(--bg-1)] px-4 py-6 text-center">
              <span className="inline-flex items-center gap-2 text-[13px] text-[var(--t-3)]">
                <ScanSearch className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                Aucune preuve pour l&apos;instant — ta première capture pose la base de ton suivi.
              </span>
            </div>
          )}
        </section>

        <p className="wow-reveal t-foot max-w-prose text-[var(--t-4)]">
          Les positions extraites sont confrontées à ton journal déclaré. Ce suivi se base sur
          l&apos;historique que tu fournis — il vaut ce que vaut ta régularité, et c&apos;est
          exactement ce qu&apos;il mesure.
        </p>
      </div>
    </main>
  );
}
