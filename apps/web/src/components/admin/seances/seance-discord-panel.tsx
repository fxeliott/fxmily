'use client';

import { AlertTriangle, Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { AdminLatestMessages } from '@/lib/seances/admin-service';

/**
 * Écrit `text` dans le presse-papier. Essaie l'API asynchrone (contexte
 * sécurisé), puis retombe sur `execCommand('copy')` via un `<textarea>` hors
 * écran quand l'API est absente OU refusée (permission / contexte non sécurisé).
 * Miroir fidèle du hub statique (src/assets/js/admin.js copyText/fallbackCopy).
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // API présente mais rejetée → on tente le repli synchrone ci-dessous.
  }
  return fallbackCopy(text);
}

/** Repli `execCommand('copy')` (déprécié mais universel) via un textarea caché. */
function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch {
    return false;
  }
}

/**
 * Réunion hub (séances) — the 6 copyable Discord messages of the most-recent
 * held session (J3, Client Component). Mirrors the static hub: one `<pre>` +
 * "Copier" per message (5 assets + DXY), in pipeline order. The TEXT is produced
 * by the faithful J4 pipeline (Règle n°1) and shown verbatim — the admin copies,
 * never edits. Until J4 fills `ReplayMessage` rows, the parent renders nothing.
 *
 * Posture §2 / 0 emoji (lucide SVG icons), 0 IA/model mention. A copy that fails
 * (API refusée ET repli KO) n'est JAMAIS silencieuse : le bouton bascule sur
 * « Copie impossible » et une région `aria-live` l'annonce (parité avec le hub).
 */
export function SeanceDiscordPanel({ latest }: { latest: AdminLatestMessages }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [failedIndex, setFailedIndex] = useState<number | null>(null);

  async function copy(text: string, index: number): Promise<void> {
    const ok = await writeToClipboard(text);
    if (ok) {
      setFailedIndex((c) => (c === index ? null : c));
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((c) => (c === index ? null : c)), 2000);
    } else {
      setCopiedIndex((c) => (c === index ? null : c));
      setFailedIndex(index);
      window.setTimeout(() => setFailedIndex((c) => (c === index ? null : c)), 4000);
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
          const failed = failedIndex === index;
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
                  className={
                    failed
                      ? 'rounded-control inline-flex items-center gap-1 border border-[var(--warn-edge)] px-2 py-1 text-[11px] text-[var(--warn)] transition-colors'
                      : 'rounded-control inline-flex items-center gap-1 border border-[var(--b-default)] px-2 py-1 text-[11px] text-[var(--t-2)] transition-colors hover:border-[var(--b-acc)] hover:text-[var(--acc-hi)]'
                  }
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                      Copié
                    </>
                  ) : failed ? (
                    <>
                      <AlertTriangle className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                      Copie impossible
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
                {copied
                  ? `Message ${msg.asset} copié`
                  : failed
                    ? `Copie impossible du message ${msg.asset}. Sélectionne le texte et fais Ctrl+C.`
                    : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
