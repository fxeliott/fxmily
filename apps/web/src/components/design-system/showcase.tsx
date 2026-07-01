'use client';

import { ArrowRight, Bell, Sparkles, Target } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { DataState, type DataStatus } from '@/components/ui/data-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Pill } from '@/components/ui/pill';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { SuccessState } from '@/components/ui/success-state';

/* Tokens couleur exposés (cf. @theme inline) — labels SOUS le swatch pour
   éviter tout souci de contraste sur une couleur arbitraire. */
const SURFACES = ['--bg', '--bg-1', '--bg-2', '--bg-3'] as const;
const TEXTS = ['--t-1', '--t-2', '--t-3', '--t-4'] as const;
const ACCENTS = ['--acc', '--acc-hi', '--acc-2', '--cy'] as const;
const STATES = ['--ok', '--bad', '--warn'] as const;
const DATAVIZ = ['--dv-1', '--dv-2', '--dv-3'] as const;

const TYPO: { cls: string; label: string; sample: string }[] = [
  { cls: 't-display', label: '.t-display', sample: 'Deviens plus discipliné' },
  { cls: 't-h1', label: '.t-h1', sample: 'Titre de page' },
  { cls: 't-h2', label: '.t-h2', sample: 'Titre de section' },
  { cls: 't-h3', label: '.t-h3', sample: 'Sous-titre de carte' },
  { cls: 't-lead', label: '.t-lead', sample: 'Paragraphe d’introduction, posé et lisible.' },
  {
    cls: 't-body',
    label: '.t-body',
    sample: 'Texte courant, la base de lecture du suivi quotidien.',
  },
  { cls: 't-eyebrow', label: '.t-eyebrow', sample: 'Sur-titre' },
  { cls: 't-cap', label: '.t-cap', sample: 'Légende / métadonnée discrète' },
  { cls: 't-foot', label: '.t-foot', sample: 'Mention de pied' },
];

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="rounded-card h-14 w-full border border-[var(--b-default)]"
        style={{ background: `var(${token})` }}
      />
      <code className="t-foot text-[var(--t-3)]">{token}</code>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="t-h2 text-[var(--t-1)]">{title}</h2>
        {hint ? <p className="t-cap text-[var(--t-3)]">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function DesignSystemShowcase() {
  const [status, setStatus] = useState<DataStatus>('ready');

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-12 px-4 py-10 sm:px-6">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[var(--acc)]" strokeWidth={1.75} aria-hidden />
          <h1 className="t-h1 text-[var(--t-1)]">Design System · Fxmily</h1>
        </div>
        <p className="t-lead max-w-[60ch] text-[var(--t-2)]">
          Vitrine vivante des tokens et primitives (S9). Référence anti-régression. Change de thème
          via le bouton de la sidebar pour vérifier light / dark. Route dev uniquement.
        </p>
      </header>

      {/* Couleurs */}
      <Section
        title="Couleurs"
        hint="Mono-accent bleu lumineux · spectre cool · pas de violet (anti-AI-slop)"
      >
        <div className="flex flex-col gap-5">
          {[
            { label: 'Surfaces', tokens: SURFACES },
            { label: 'Textes', tokens: TEXTS },
            { label: 'Accents', tokens: ACCENTS },
            { label: 'États', tokens: STATES },
            { label: 'Data-viz', tokens: DATAVIZ },
          ].map((row) => (
            <div key={row.label} className="flex flex-col gap-2">
              <span className="t-eyebrow text-[var(--t-3)]">{row.label}</span>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {row.tokens.map((t) => (
                  <Swatch key={t} token={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Typographie */}
      <Section
        title="Typographie"
        hint="Geist (display) · Inter (corps) · JetBrains Mono (chiffres)"
      >
        <Card className="flex flex-col divide-y divide-[var(--b-default)]">
          {TYPO.map((t) => (
            <div
              key={t.cls}
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4"
            >
              <code className="t-foot w-28 shrink-0 text-[var(--t-3)]">{t.label}</code>
              <span className={`${t.cls} text-[var(--t-1)]`}>{t.sample}</span>
            </div>
          ))}
        </Card>
      </Section>

      {/* Boutons */}
      <Section
        title="Boutons"
        hint="Source unique : <Btn> · 4 kinds × 3 sizes × 6 états · touch ≥ 44px"
      >
        <Card className="flex flex-col gap-5 p-5">
          {(['primary', 'secondary', 'ghost', 'danger'] as const).map((kind) => (
            <div key={kind} className="flex flex-wrap items-center gap-3">
              <span className="t-foot w-20 shrink-0 text-[var(--t-3)]">{kind}</span>
              <Btn kind={kind} size="s">
                Small
              </Btn>
              <Btn kind={kind} size="m">
                Medium
              </Btn>
              <Btn kind={kind} size="l">
                Large
              </Btn>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--b-default)] pt-4">
            <span className="t-foot w-20 shrink-0 text-[var(--t-3)]">états</span>
            <Btn kind="primary" loading>
              Chargement
            </Btn>
            <Btn kind="primary" disabled>
              Désactivé
            </Btn>
            <Btn kind="secondary" kbd="⌘K">
              Avec kbd
            </Btn>
            <Btn kind="primary">
              CTA
              <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />
            </Btn>
          </div>
        </Card>
      </Section>

      {/* Pills */}
      <Section title="Pills" hint="7 tons sémantiques · point statique / live">
        <Card className="flex flex-wrap items-center gap-3 p-5">
          {(['mute', 'acc', 'ok', 'bad', 'warn', 'cy', 'solid'] as const).map((tone) => (
            <Pill key={tone} tone={tone}>
              {tone}
            </Pill>
          ))}
          <Pill tone="acc" dot>
            dot
          </Pill>
          <Pill tone="ok" dot="live">
            live
          </Pill>
        </Card>
      </Section>

      {/* Cards */}
      <Section
        title="Cartes"
        hint="Élévation Mercury multi-couches · edge-top Linear · hover compositor-only"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="p-4">
            <p className="t-h3 text-[var(--t-1)]">Default</p>
            <p className="t-cap mt-1 text-[var(--t-3)]">Surface neutre.</p>
          </Card>
          <Card primary className="p-4">
            <p className="t-h3 text-[var(--t-1)]">Primary</p>
            <p className="t-cap mt-1 text-[var(--t-3)]">Gradient accent (1-2/écran max).</p>
          </Card>
          <Card selected className="p-4">
            <p className="t-h3 text-[var(--t-1)]">Selected</p>
            <p className="t-cap mt-1 text-[var(--t-3)]">Anneau accent 4px.</p>
          </Card>
          <Card interactive className="p-4">
            <p className="t-h3 text-[var(--t-1)]">Interactive</p>
            <p className="t-cap mt-1 text-[var(--t-3)]">Survole-moi (hover).</p>
          </Card>
          <Card glass className="p-4">
            <p className="t-h3 text-[var(--t-1)]">Glass</p>
            <p className="t-cap mt-1 text-[var(--t-3)]">Panneau translucide.</p>
          </Card>
        </div>
      </Section>

      {/* États de données */}
      <Section
        title="États de données"
        hint="Skeleton · DataState (loading / empty / error / ready) · SuccessState, fini les écrans morts"
      >
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-5">
            <span className="t-eyebrow text-[var(--t-3)]">Skeletons</span>
            <div className="flex items-center gap-3">
              <Skeleton circle className="h-10 w-10" />
              <div className="flex-1">
                <SkeletonText lines={2} />
              </div>
            </div>
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="t-eyebrow mr-1 text-[var(--t-3)]">DataState</span>
              {(['ready', 'loading', 'empty', 'error'] as const).map((s) => (
                <Btn
                  key={s}
                  kind={status === s ? 'primary' : 'ghost'}
                  size="s"
                  onClick={() => setStatus(s)}
                  aria-pressed={status === s}
                >
                  {s}
                </Btn>
              ))}
            </div>
            <div className="rounded-card border border-[var(--b-default)] bg-[var(--bg)] p-2">
              <DataState
                status={status}
                loading={<SkeletonText lines={4} className="p-4" />}
                empty={
                  <EmptyState
                    icon={Target}
                    headingLevel="h3"
                    headline="Pas encore de données"
                    lead="C’est normal au démarrage, chaque jour ajoute une brique."
                    guides={['Fais ton check-in du matin', 'Journalise ton premier trade']}
                    ctaPrimary="Commencer"
                    onPrimary={() => setStatus('ready')}
                  />
                }
                error={
                  <ErrorState
                    headingLevel="h3"
                    headline="Synchronisation impossible"
                    action="Vérifie ta connexion puis réessaie."
                    cause="DEMO: simulated 503 — request-id 8f2c"
                    onRetry={() => setStatus('ready')}
                  />
                }
              >
                <div className="flex items-center gap-2 p-4">
                  <Bell className="h-4 w-4 text-[var(--acc)]" strokeWidth={1.75} aria-hidden />
                  <p className="t-body text-[var(--t-1)]">Contenu prêt, données chargées.</p>
                </div>
              </DataState>
            </div>
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            <span className="t-eyebrow text-[var(--t-3)]">
              SuccessState · 4e état (succès / feedback)
            </span>
            <SuccessState headline="Trade enregistré.">
              C&apos;est posé dans ton journal. Reviens demain pour le prochain.
            </SuccessState>
          </Card>
        </div>
      </Section>

      {/* Dialog (exerce le bouton de fermeture migré) */}
      <Section
        title="Dialog"
        hint="Radix + chrome DS · le bouton « Fermer » exerce la migration single-source"
      >
        <Dialog>
          <DialogTrigger asChild>
            <Btn kind="secondary">Ouvrir la modale</Btn>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Exemple de modale</DialogTitle>
              <DialogDescription>
                Surface modale du design system. Le bouton de fermeture ci-dessous utilise la
                primitive <code className="font-mono">Btn</code>.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      </Section>
    </div>
  );
}
