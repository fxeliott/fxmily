'use client';

import { ArrowUp, Brain, Lock, Shield, Upload, Zap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Btn, btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Pill } from '@/components/ui/pill';
import { Sparkline } from '@/components/ui/sparkline';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Splash hero — client component pour les animations (word-rise stagger,
 * count-up sync, sparkline draw 1400ms locked, drift orb).
 *
 * Posture athlète discipline. Mono-accent lime. Anti-AI-slop strict.
 */
export function SplashHero() {
  const [start, setStart] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStart(true), 240);
    return () => clearTimeout(t);
  }, []);

  // Demo telemetry — strictly NOT real data, just a discipline signature
  // (steady upward trajectory). Public splash, no real KPIs.
  const demoData = [0, 0.4, 0.3, 0.7, 0.9, 0.8, 1.2, 1.5, 1.4, 1.8, 2.1, 2.0, 2.4, 2.7, 3.0];

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Aurora hero ambient (subtle lime + indigo radial gradients) */}
      <div aria-hidden className="aurora pointer-events-none absolute inset-0" />

      {/* Drift orb (slow 18s loop, lime translucent) */}
      <div
        aria-hidden
        className="orb pointer-events-none absolute -left-32 -top-32 h-[460px] w-[460px] rounded-full opacity-30"
        style={{
          background: 'radial-gradient(circle, oklch(0.879 0.231 130 / 0.18) 0%, transparent 70%)',
        }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-5 pt-7 sm:px-12">
        <div className="flex items-center gap-2.5">
          <div className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[10px] font-bold text-[var(--acc)]">
            F
          </div>
          <span className="f-display text-[14px] font-semibold tracking-[-0.01em]">Fxmily</span>
          <Pill className="ml-1.5">v1 · BETA</Pill>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] tabular-nums text-[var(--t-3)]">
            <span
              className="live-dot h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--ok)' }}
            />
            opérationnel
          </span>
          <Pill className="hidden sm:inline-flex">ACCÈS · INVITATION</Pill>
        </div>
      </header>

      {/* Hero grid */}
      <div className="relative z-10 grid flex-1 items-center gap-7 px-5 py-6 sm:gap-12 sm:px-12 sm:py-10 lg:grid-cols-[1.05fr_1fr]">
        {/* Copy */}
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--acc)]">
            <span className="h-1 w-1 rounded-full bg-current" />
            <span>Journal · Discipline · Mental</span>
            <span className="h-3 w-px bg-current opacity-30" />
            <span className="text-[var(--t-3)]">Saison · Mai 2026</span>
          </div>

          <h1
            className="f-display text-[40px] font-bold leading-[0.94] tracking-[-0.045em] text-[var(--t-1)] sm:text-[68px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            <span className="word-rise inline-block" style={{ animationDelay: '120ms' }}>
              Trade
            </span>{' '}
            <span className="word-rise inline-block" style={{ animationDelay: '200ms' }}>
              comme
            </span>{' '}
            <span className="word-rise inline-block" style={{ animationDelay: '280ms' }}>
              un
            </span>{' '}
            <span
              className="word-rise inline-block text-[var(--acc)]"
              style={{ animationDelay: '440ms' }}
            >
              athlète,
            </span>{' '}
            <span className="word-rise inline-block" style={{ animationDelay: '560ms' }}>
              pas
            </span>{' '}
            <span className="word-rise inline-block" style={{ animationDelay: '640ms' }}>
              un
            </span>{' '}
            <span className="word-rise inline-block" style={{ animationDelay: '720ms' }}>
              spectateur.
            </span>
          </h1>

          <p className="t-lead max-w-[36ch] sm:max-w-[44ch]">
            Le seul journal qui ignore le marché. On mesure ton plan, ta discipline, ton mental —
            pas les bougies.
          </p>

          <div className="flex flex-col gap-2.5 pt-1 sm:flex-row">
            <Link href="/login" className={cn(btnVariants({ kind: 'primary', size: 'l' }))}>
              Se connecter
              <Kbd inline className="ml-1">
                ↵
              </Kbd>
            </Link>
            <Btn kind="secondary" size="l">
              Demander un accès
            </Btn>
          </div>

          {/* Trust strip — 5 items pédago */}
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 text-[11px] tabular-nums text-[var(--t-3)]">
            <Tooltip>
              <TooltipTrigger asChild>
                <li className="inline-flex cursor-help items-center gap-1">
                  <Lock className="h-[11px] w-[11px]" strokeWidth={1.75} />
                  Chiffré E2E
                </li>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                style={{ maxWidth: 240 }}
                className="rounded-tooltip border border-[var(--b-strong)] bg-[var(--bg-3)] px-2.5 py-2 text-left text-[11px] font-normal normal-case leading-[1.45] tracking-normal text-[var(--t-2)] shadow-[var(--sh-tooltip)]"
              >
                AES-256 sur les screenshots et notes mentales. Personne d&apos;autre que toi ne lit
                tes trades.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <li className="inline-flex cursor-help items-center gap-1">
                  <Shield className="h-[11px] w-[11px]" strokeWidth={1.75} />
                  Cohorte privée
                </li>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                style={{ maxWidth: 220 }}
                className="rounded-tooltip border border-[var(--b-strong)] bg-[var(--bg-3)] px-2.5 py-2 text-left text-[11px] font-normal normal-case leading-[1.45] tracking-normal text-[var(--t-2)] shadow-[var(--sh-tooltip)]"
              >
                Cohorte fermée — accès uniquement par invitation d&apos;un membre actif.
              </TooltipContent>
            </Tooltip>
            <li className="inline-flex items-center gap-1">
              <Zap className="h-[11px] w-[11px]" strokeWidth={1.75} />
              &lt;200ms · p99
            </li>
            <li className="inline-flex items-center gap-1">
              <Brain className="h-[11px] w-[11px]" strokeWidth={1.75} />
              Aucun signal de marché
            </li>
            <Tooltip>
              <TooltipTrigger asChild>
                <li className="inline-flex cursor-help items-center gap-1">
                  <Upload className="h-[11px] w-[11px]" strokeWidth={1.75} />
                  Export libre
                </li>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                style={{ maxWidth: 240 }}
                className="rounded-tooltip border border-[var(--b-strong)] bg-[var(--bg-3)] px-2.5 py-2 text-left text-[11px] font-normal normal-case leading-[1.45] tracking-normal text-[var(--t-2)] shadow-[var(--sh-tooltip)]"
              >
                Export brut JSON / CSV à tout moment. Tes données ne sont pas captives.
              </TooltipContent>
            </Tooltip>
          </ul>
        </div>

        {/* Hero bento (desktop only — mobile gets simplified card after) */}
        <div className="hidden lg:block">
          <Card primary className="ml-auto max-w-[480px] overflow-hidden p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="t-eyebrow">Discipline · 30 jours</span>
              <Pill tone="acc" dot="live">
                LIVE
              </Pill>
            </div>

            {/* Big telemetry signature (NOT real KPIs — public splash) */}
            <div className="flex items-baseline gap-3">
              <span
                className="f-mono text-[56px] font-semibold tabular-nums leading-none tracking-[-0.045em] text-[var(--acc)]"
                style={{
                  filter: 'drop-shadow(0 0 18px oklch(0.879 0.231 130 / 0.32))',
                }}
              >
                +91%
              </span>
              <span className="mb-1.5 inline-flex items-center gap-0.5 font-mono text-[12px] tabular-nums text-[var(--ok)]">
                <ArrowUp className="h-[11px] w-[11px]" strokeWidth={1.75} />
                plan respecté
              </span>
            </div>

            <p className="t-cap mt-2.5">
              Métrique signature Fxmily — discipline mesurée par adhérence au plan, pas par P&amp;L.
            </p>

            <div className="mt-3.5 flex items-end justify-between gap-3">
              <Sparkline
                data={demoData}
                width={300}
                height={36}
                color="var(--acc)"
                fill
                showLastDot
                animate={start}
                ariaLabel="Tendance discipline 30 derniers jours"
              />
              <div className="flex shrink-0 flex-col items-end">
                <span className="t-mono-cap">cible</span>
                <span className="font-mono text-[10px] tabular-nums text-[var(--t-3)]">≥ 80%</span>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-[var(--t-4)]">
              <span className="live-dot h-1 w-1 rounded-full" style={{ background: 'var(--ok)' }} />
              démo · données illustratives
            </div>
          </Card>
        </div>

        {/* Mobile bento simplified */}
        <div className="lg:hidden">
          <Card primary className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="t-eyebrow">Discipline</span>
              <Pill tone="acc" dot="live">
                LIVE
              </Pill>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="f-mono text-[40px] font-semibold tabular-nums leading-none tracking-[-0.04em] text-[var(--acc)]">
                +91%
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--ok)]">plan</span>
            </div>
            <p className="t-cap mt-2">Démo · adhérence plan, pas P&amp;L.</p>
            <div className="mt-3">
              <Sparkline
                data={demoData}
                width={300}
                height={32}
                color="var(--acc)"
                fill
                animate={start}
                ariaLabel="Tendance discipline"
              />
            </div>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 flex items-center justify-between border-t border-[var(--b-default)] px-5 py-3.5 text-[10px] sm:px-12 sm:py-4 sm:text-[11px]">
        <div className="flex items-center gap-3 tabular-nums text-[var(--t-4)]">
          <span>© 2026 Fxmily</span>
          <span>·</span>
          <span className="t-foot">Aucun conseil de marché</span>
        </div>
        <div className="flex items-center gap-3 tabular-nums text-[var(--t-4)]">
          <span className="hidden sm:inline">Cohorte privée</span>
          <span className="inline-flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>?</Kbd>
            raccourcis
          </span>
        </div>
      </footer>
    </main>
  );
}
