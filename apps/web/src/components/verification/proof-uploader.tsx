'use client';

import { Image as ImageIcon, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useRef, useState } from 'react';

import { Spinner } from '@/components/spinner';
import { PROOF_ACCOUNT_TYPES, type ProofAccountType } from '@/lib/schemas/verification';
import { compressProofImage } from '@/lib/uploads/compress-proof-client';
import { convertHeicToJpeg, isHeicFile } from '@/lib/uploads/heic.client';
import { cn } from '@/lib/utils';

interface ProofUploaderAccountOption {
  readonly id: string;
  readonly label: string;
}

interface ProofUploaderProps {
  /** The member's broker accounts — the proof can be attached at upload time. */
  accounts: readonly ProofUploaderAccountOption[];
}

/**
 * Tour 13 — a proof accepts any common phone/desktop capture format: it is
 * normalised to JPEG server-side. 20 MiB raw ceiling (a HEIC-exported PNG can
 * be heavy before normalisation). HEIC itself is undecodable server-side →
 * converted to JPEG in the browser (same lazy WASM path as the avatar).
 */
const ACCEPTED_INPUT_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
] as const;
const MAX_PROOF_INPUT_BYTES = 20 * 1024 * 1024;

const ERROR_LABELS = {
  unauthorized: 'Session expirée, reconnecte-toi.',
  invalid_form: 'Formulaire invalide.',
  uploads_closed: 'Les captures sont réservées à la vérification.',
  invalid_account_id: 'Compte invalide, recharge la page.',
  invalid_account_type: 'Type de compte invalide.',
  missing_file: 'Aucun fichier sélectionné.',
  empty_file: 'Le fichier est vide.',
  too_large: 'Image trop lourde (20 Mo max).',
  invalid_mime: 'Format non supporté. Utilise JPG, PNG, WebP, GIF ou AVIF.',
  invalid_bytes: 'Le fichier ne ressemble pas à une vraie image.',
  heic_unsupported:
    'Cette capture iPhone (HEIC) n’a pas pu être convertie. Réessaie, ou exporte-la en JPEG (Réglages > Appareil photo > Formats > Le plus compatible).',
  duplicate_proof: 'Cette capture a déjà été envoyée, pas besoin de la renvoyer.',
  rate_limited: 'Trop d’envois d’un coup, attends quelques secondes.',
  storage_failed: "Échec de l'enregistrement, réessaie.",
} as const satisfies Record<string, string>;

function errorLabel(code: string | undefined): string {
  if (code && code in ERROR_LABELS) return ERROR_LABELS[code as keyof typeof ERROR_LABELS];
  return 'Échec de l’envoi.';
}

// HEIC/HEIF are offered by the picker (iOS default capture format) and
// converted to JPEG in the browser before the POST.
const ACCEPT = [...ACCEPTED_INPUT_MIME, 'image/heic', 'image/heif'].join(',');

const ACCOUNT_TYPE_LABELS: Record<ProofAccountType, string> = {
  prop_firm: 'Prop firm',
  personal: 'Compte perso',
};

/** Taille lisible d'un fichier (Ko en dessous de 1 Mo, sinon Mo à 1 décimale). */
function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

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
  // Taille du fichier en cours d'envoi, affichée pendant l'upload (rassure sur
  // « c'est bien parti », null hors upload).
  const [uploadingSize, setUploadingSize] = useState<number | null>(null);

  const upload = useCallback(
    async (file: File) => {
      // Client-side guards — server re-validates regardless.
      if (file.size === 0) {
        setStatus('error');
        setMessage(errorLabel('empty_file'));
        return;
      }
      if (file.size > MAX_PROOF_INPUT_BYTES) {
        setStatus('error');
        setMessage(errorLabel('too_large'));
        return;
      }
      // HEIC often surfaces as `image/heic`/`image/heif` (or an empty type
      // from the OS picker) — it is converted to JPEG in the browser below
      // instead of being rejected.
      const isHeicType = file.type === 'image/heic' || file.type === 'image/heif';
      // Empty type (some pickers) is tolerated — the server sniffs magic bytes.
      if (
        !isHeicType &&
        file.type !== '' &&
        !(ACCEPTED_INPUT_MIME as readonly string[]).includes(file.type)
      ) {
        setStatus('error');
        setMessage(errorLabel('invalid_mime'));
        return;
      }

      setStatus('uploading');
      setMessage(null);
      setUploadingSize(file.size);

      // Convert an iPhone HEIC capture to JPEG in the browser (same lazy WASM
      // path as the avatar) so the member uploads without touching any phone
      // setting. `isHeicFile` sniffs the ftyp box, so an empty-MIME HEIC from
      // the OS picker converts too. The server still rejects raw HEIC
      // (defense-in-depth).
      let source = file;
      try {
        if (isHeicType || (await isHeicFile(file))) {
          source = await convertHeicToJpeg(file);
          setUploadingSize(source.size);
        }
      } catch {
        setStatus('error');
        setMessage(errorLabel('heic_unsupported'));
        setUploadingSize(null);
        return;
      }

      // Tour 14 — shrink a heavy capture in the browser before the transfer so
      // the slow part (mobile uplink) sends a few hundred KB instead of several
      // MB. Best-effort: returns the raw file untouched on any failure or for a
      // small capture. The server re-normalises regardless, so this only speeds
      // the wire. Reflect the actually-sent size in the copy.
      const toSend = await compressProofImage(source);
      if (toSend.size !== source.size) setUploadingSize(toSend.size);

      const fd = new FormData();
      fd.append('file', toSend);
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
            <option value="">À rattacher plus tard</option>
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
            <option value="">Non précisé</option>
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
            <div className="flex flex-col items-center gap-1">
              <span className="t-body text-[var(--t-2)]">
                Envoi en cours, ne ferme pas encore cette page.
              </span>
              {uploadingSize !== null ? (
                <span className="t-cap text-[var(--t-4)]">
                  {formatFileSize(uploadingSize)} en cours de transfert
                </span>
              ) : null}
            </div>
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
                Onglet « Historique » de MT5 · JPG, PNG, WebP, GIF, AVIF ou HEIC (iPhone), 20 Mo max
              </span>
            </div>
          </>
        )}
      </label>

      <p className="t-cap text-[var(--t-3)]">
        {/* HONEST copy (runtime finding 2026-07-08) : proofs ARE kept — the
            gallery below lists them and /api/uploads gates access to the
            owner + the coach. The previous « analysée puis supprimée : jamais
            conservée » was contradicted two blocks lower on the same page. */}
        Ta capture est conservée dans ton espace de vérification, visible ci-dessous. Toi et le
        coach seuls pouvez la consulter ; elle ne sert qu’à vérifier tes trades.
      </p>

      {status === 'success' ? (
        <p
          className="inline-flex items-start gap-1.5 text-[11px] leading-[1.5] text-[var(--ok)]"
          role="status"
        >
          <ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>
            Capture reçue. L’analyse tourne en arrière-plan, en général sous 5 minutes. Tu peux
            quitter cette page, on te prévient dès que c’est vérifié.
          </span>
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
