'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { AdminLatestMessages } from '@/lib/seances/admin-service';

/**
 * Réunion hub (séances) — the 6 copyable Discord messages of the most-recent
 * held session (J3, Client Component). Mirrors the static hub: one `<pre>` +
 * "Copier" per message (5 assets + DXY), in pipeline order. The TEXT is produced
 * by the faithful J4 pipeline (Règle n°1) and shown verbatim — the admin copies,
 * never edits. Until J4 fills `ReplayMessage` rows, the parent renders nothing.
 *
 * Posture §2 / 0 emoji (lucide SVG icons), 0 IA/model mention.
 */
export function SeanceDiscordPanel({ latest }: { latest: AdminLatestMessages }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  async function copy(text: string, index: number): Promise<void> {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (ok) {
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((c) => (c === index ? null : c)), 2000);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="t-eyebrow-lg text-[var(--t-3)]">Messages Discord</p>
          <p className="t-cap text-[var(--t-3)]">
            Dernière séance tenue · {latest.title}. Copie chaque message avant la séance.
          </p>
        </div>
        <Pill tone="acc">{latest.messages.length} messages</Pill>
      </div>

      <ul className="flex flex-col gap-2">
        {latest.messages.map((msg, index) => {
          const copied = copiedIndex === index;
          return (
            <li
              key={`${msg.asset}-${index}`}
              className="rounded-card flex flex-col gap-1.5 border border-[var(--b-default)] bg-[var(--bg-1)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="t-mono-cap font-semibold text-[var(--t-2)]">{msg.asset}</span>
                <button
                  type="button"
                  onClick={() => void copy(msg.text, index)}
                  aria-label={`Copier le message ${msg.asset}`}
                  className="rounded-control inline-flex items-center gap-1 border border-[var(--b-default)] px-2 py-1 text-[11px] text-[var(--t-2)] transition-colors hover:border-[var(--b-acc)] hover:text-[var(--acc-hi)]"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                      Copié
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                      Copier
                    </>
                  )}
                </button>
              </div>
              <pre className="t-cap font-sans break-words whitespace-pre-wrap text-[var(--t-1)]">
                {msg.text}
              </pre>
              <span aria-live="polite" className="sr-only">
                {copied ? `Message ${msg.asset} copié` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
