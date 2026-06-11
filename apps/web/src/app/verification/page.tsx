import { ArrowLeft, ScanSearch, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { AccountCreateForm } from '@/components/verification/account-create-form';
import { DeleteProofButton } from '@/components/verification/delete-proof-button';
import { ProofUploader } from '@/components/verification/proof-uploader';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { getVerificationOverview } from '@/lib/verification/service';

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

export default async function VerificationPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  const overview = await getVerificationOverview(session.user.id);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Tableau de bord
        </Link>
        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow-lg text-[var(--t-3)]">Vérification</span>
          <h1 className="f-display h-rise text-[28px] leading-[1.05] font-bold text-[var(--t-1)]">
            Ta réalité de trading
          </h1>
          <p className="t-body leading-[1.6] text-[var(--t-2)]">
            Ici, ton trading déclaré est mis en face de ton historique MT5 réel. Pas pour te juger —
            pour t&apos;aider à te voir tel que tu es, et progresser à partir de là. Ce qui est
            confronté, c&apos;est l&apos;historique que tu fournis : jamais tes analyses, jamais de
            conseil de marché.
          </p>
        </div>
      </header>

      {/* Comptes broker */}
      <section className="flex flex-col gap-3" aria-labelledby="accounts-heading">
        <h2 id="accounts-heading" className="t-h2 text-[var(--t-1)]">
          Tes comptes
        </h2>
        {overview.accounts.length === 0 ? (
          <p className="t-body text-[var(--t-3)]">
            Déclare chacun de tes comptes — prop firm et perso. C&apos;est la base du suivi : un
            compte non déclaré finit toujours par se voir dans les écarts.
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          {overview.accounts.map((account) => (
            <Card key={account.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]">
                <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
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
              {account.detectedByAI ? (
                <Pill tone="cy">Détecté par l&apos;analyse</Pill>
              ) : (
                <Pill tone="mute">Déclaré</Pill>
              )}
            </Card>
          ))}
        </div>
        <Card className="flex flex-col gap-3 p-4">
          <span className="t-h3 text-[var(--t-1)]">Déclarer un compte</span>
          <AccountCreateForm />
        </Card>
      </section>

      {/* Preuves MT5 */}
      <section className="flex flex-col gap-3" aria-labelledby="proofs-heading">
        <h2 id="proofs-heading" className="t-h2 text-[var(--t-1)]">
          Tes preuves MT5
        </h2>
        <p className="t-body leading-[1.6] text-[var(--t-2)]">
          Téléverse une capture de l&apos;onglet « Historique » de MT5 pour{' '}
          <strong className="font-semibold text-[var(--t-1)]">chacun</strong> de tes comptes.
          L&apos;analyse lit les positions affichées et les confronte à ton journal. Une capture
          reste une capture — c&apos;est la régularité de tes preuves qui construit la confiance.
        </p>
        <Card className="flex flex-col gap-3 p-4">
          <ProofUploader accounts={overview.accounts.map((a) => ({ id: a.id, label: a.label }))} />
        </Card>

        {overview.proofs.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {overview.proofs.map((proof) => {
              const statusMeta = OCR_STATUS_META[proof.ocrStatus];
              const account = proof.brokerAccountId
                ? overview.accounts.find((a) => a.id === proof.brokerAccountId)
                : undefined;
              return (
                <li key={proof.id}>
                  <Card className="flex flex-wrap items-center gap-3 p-4">
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
              <ScanSearch className="h-4 w-4" strokeWidth={1.75} />
              Aucune preuve pour l&apos;instant — ta première capture pose la base de ton suivi.
            </span>
          </div>
        )}
      </section>

      <p className="t-foot text-[var(--t-4)]">
        Les positions extraites sont confrontées à ton journal déclaré. Ce suivi se base sur
        l&apos;historique que tu fournis — il vaut ce que vaut ta régularité, et c&apos;est
        exactement ce qu&apos;il mesure.
      </p>
    </main>
  );
}
