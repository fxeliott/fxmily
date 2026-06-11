'use client';

import { Image as ImageIcon, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useRef, useState } from 'react';

import { Spinner } from '@/components/spinner';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_SCREENSHOT_BYTES } from '@/lib/storage/types';
import { PROOF_ACCOUNT_TYPES, type ProofAccountType } from '@/lib/schemas/verification';
import { cn } from '@/lib/utils';

interface ProofUploaderAccountOption {
  readonly id: string;
  readonly label: string;
}

interface ProofUploaderProps {
  /** The member's broker accounts — the proof can be attached at upload time. */
  accounts: readonly ProofUploaderAccountOption[];
}

const ERROR_LABELS = {
  unauthorized: 'Session expirée, reconnecte-toi.',
  invalid_form: 'Formulaire invalide.',
  invalid_kind: 'Type de capture invalide.',
  invalid_account_id: 'Compte invalide — recharge la page.',
  invalid_account_type: 'Type de compte invalide.',
  missing_file: 'Aucun fichier sélectionné.',
  empty_file: 'Le fichier est vide.',
  too_large: 'Image trop lourde (8 Mo max).',
  invalid_mime: 'Format non supporté. Utilise JPG, PNG ou WebP.',
  invalid_bytes: 'Le fichier ne ressemble pas à une vraie image.',
  duplicate_proof: 'Cette capture a déjà été envoyée — pas besoin de la renvoyer.',
  rate_limited: 'Trop d’envois d’un coup, attends quelques secondes.',
  storage_failed: "Échec de l'enregistrement, réessaie.",
} as const satisfies Record<string, string>;

function errorLabel(code: string | undefined): string {
  if (code && code in ERROR_LABELS) return ERROR_LABELS[code as keyof typeof ERROR_LABELS];
  return 'Échec de l’envoi.';
}

const ACCEPT = ALLOWED_IMAGE_MIME_TYPES.join(',');

const ACCOUNT_TYPE_LABELS: Record<ProofAccountType, string> = {
  prop_firm: 'Prop firm',
  personal: 'Compte perso',
};

/**
 * S3 — MT5 history proof uploader (`/verification`, SPEC §33).
 *
 * Carbon of the journal `ScreenshotUploader` adapted to the proof flow:
 * the POST carries `kind=mt5-proof` (+ optional `accountId` / `accountType`),
 * the row is created server-side in the same request (SHA-256 dedup), and on
 * success the page is refreshed so the new proof appears in the list — no
 * hidden form field, no parent wizard.
 */
export function ProofUploader({ accounts }: ProofUploaderProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [accountId, setAccountId] = useState<string>('');
  const [accountType, setAccountType] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      // Client-side guards — server re-validates regardless.
      if (file.size === 0) {
        setStatus('error');
        setMessage(errorLabel('empty_file'));
        return;
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        setStatus('error');
        setMessage(errorLabel('too_large'));
        return;
      }
      if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
        setStatus('error');
        setMessage(errorLabel('invalid_mime'));
        return;
      }

      setStatus('uploading');
      setMessage(null);

      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'mt5-proof');
      if (accountId) fd.append('accountId', accountId);
      if (accountType) fd.append('accountType', accountType);

      try {
        const res = await fetch('/api/uploads', { method: 'POST', body: fd });
        const payload = (await res.json().catch(() => ({}))) as {
          proofId?: string;
          error?: string;
        };
        if (!res.ok || !payload.proofId) {
          setStatus('error');
          setMessage(errorLabel(payload.error));
          return;
        }
        setStatus('success');
        setMessage(null);
        if (inputRef.current) inputRef.current.value = '';
        router.refresh();
      } catch (err) {
        console.error('[ProofUploader] fetch failed', err);
        setStatus('error');
        setMessage('Erreur réseau. Réessaie.');
      }
    },
    [accountId, accountType, router],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void upload(file);
  };

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="t-eyebrow text-[var(--t-3)]">Compte concerné (optionnel)</span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={status === 'uploading'}
            className="rounded-control h-11 border border-[var(--b-default)] bg-[var(--bg-1)] px-3 text-[13px] text-[var(--t-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          >
            <option value="">— À rattacher plus tard —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="t-eyebrow text-[var(--t-3)]">Type de compte (optionnel)</span>
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
            disabled={status === 'uploading'}
            className="rounded-control h-11 border border-[var(--b-default)] bg-[var(--bg-1)] px-3 text-[13px] text-[var(--t-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          >
            <option value="">— Non précisé —</option>
            {PROOF_ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-card group flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 border border-dashed px-4 py-6 text-center transition-all',
          'focus-within:border-[var(--acc)] focus-within:bg-[var(--acc-dim-2)]',
          isDragOver
            ? 'border-[var(--acc)] bg-[var(--acc-dim)]'
            : 'border-[var(--b-strong)] bg-[var(--bg-1)] hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)]',
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={onFileChange}
          disabled={status === 'uploading'}
          aria-invalid={message ? 'true' : undefined}
          aria-describedby={[hintId, message ? errorId : null].filter(Boolean).join(' ')}
        />

        {status === 'uploading' ? (
          <>
            <div className="grid h-12 w-12 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
              <Spinner size={20} label="Envoi en cours" />
            </div>
            <span className="t-body text-[var(--t-2)]">Envoi en cours…</span>
          </>
        ) : (
          <>
            <div
              className={cn(
                'grid h-12 w-12 place-items-center rounded-full border transition-all',
                isDragOver
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--acc)]'
                  : 'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]',
              )}
            >
              <Upload className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="t-h3 text-[var(--t-1)]">
                {isDragOver ? 'Lâche pour envoyer' : 'Ajoute une capture de ton historique MT5'}
              </span>
              <span id={hintId} className="t-cap text-[var(--t-4)]">
                Onglet « Historique » de MT5 — JPG · PNG · WebP, 8 Mo max
              </span>
            </div>
          </>
        )}
      </label>

      {status === 'success' ? (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ok)]" role="status">
          <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          Capture reçue — elle sera lue lors de la prochaine analyse.
        </p>
      ) : null}

      {message ? (
        <p
          id={errorId}
          role="alert"
          className="inline-flex items-center gap-1.5 text-[11px] text-[var(--bad)]"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
