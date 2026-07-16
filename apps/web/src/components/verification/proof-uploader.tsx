'use client';

import { FileWarning, Image as ImageIcon, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useRef, useState } from 'react';

import { Spinner } from '@/components/spinner';
import { CaptureGuide } from '@/components/verification/capture-guide';
import { PROOF_ACCOUNT_TYPES, type ProofAccountType } from '@/lib/schemas/verification';
import { compressProofImage } from '@/lib/uploads/compress-proof-client';
import { convertHeicToJpeg, isHeicFile } from '@/lib/uploads/heic.client';
import { cn } from '@/lib/utils';
import { isPdfBytes } from '@/lib/verification/pdf-sniff';

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

/**
 * J4.5 — network retry. A flaky mobile uplink can make the POST throw (offline,
 * DNS hiccup, connection reset) *before* any HTTP response comes back. Instead
 * of failing on the first attempt we retry up to 3 times with a growing
 * backoff, showing an "en attente du reseau" state in between. Only fetch-level
 * throws are retried: once the server answers — even with a 4xx like 410
 * `uploads_closed` or 400 — the outcome is definitive and never retried.
 */
const MAX_UPLOAD_ATTEMPTS = 3;
// One entry per gap between attempts, indexed by the attempt that just failed
// (1-based -> 0-based). The 3rd value is headroom if MAX_UPLOAD_ATTEMPTS grows.
const RETRY_BACKOFF_MS = [500, 1500, 3000] as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const [status, setStatus] = useState<'idle' | 'uploading' | 'retrying' | 'success' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // Taille du fichier en cours d'envoi, affichée pendant l'upload (rassure sur
  // « c'est bien parti », null hors upload).
  const [uploadingSize, setUploadingSize] = useState<number | null>(null);
  // J4.5 — the attempt number we're about to (re)try, shown during the
  // "en attente du reseau" backoff so the member sees progress (null off-retry).
  const [retryAttempt, setRetryAttempt] = useState<number | null>(null);
  // J4.3 — vrai quand l'erreur courante vient du sniff %PDF client (affiche un
  // message dédié + le déclencheur du mini-guide de capture au lieu de l'erreur
  // brute). J4.4 — état d'ouverture du bottom-sheet mini-guide.
  const [isPdfError, setIsPdfError] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      // Clear any prior %PDF hint + retry counter before re-evaluating this file.
      setIsPdfError(false);
      setRetryAttempt(null);
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

      // J4.3 — client-side %PDF sniff. Members sometimes "export" their MT5
      // history as a PDF instead of a screenshot; catch it here (zero network,
      // before any POST) with a dedicated, actionable message + the capture
      // mini-guide, so the file never leaves the phone. Purely additive — the
      // size / MIME / HEIC guards above are untouched. A PDF starts with the
      // magic bytes 25 50 44 46 ("%PDF"); reading 5 bytes is cheap and any
      // shorter file (already size-guarded > 0) simply won't match.
      const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      const isPdf = isPdfBytes(head);
      if (isPdf) {
        setStatus('error');
        setIsPdfError(true);
        setMessage(
          'On dirait un PDF. On a besoin d’une capture d’écran (image), pas d’un export PDF.',
        );
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

      // J4.5 — retry the POST on a network-level failure (fetch throws) with a
      // growing backoff, so a flaky mobile uplink doesn't lose the upload on the
      // first hiccup. An HTTP response — even a 4xx like 410 `uploads_closed` or
      // 400 — is never retried: the server was reached, so the result is final.
      for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
        // Actively sending this attempt (resets the "en attente du reseau"
        // state left by a prior backoff).
        setStatus('uploading');
        try {
          const res = await fetch('/api/uploads', { method: 'POST', body: fd });
          const payload = (await res.json().catch(() => ({}))) as {
            proofId?: string;
            error?: string;
          };
          if (!res.ok || !payload.proofId) {
            // The server answered (410 uploads_closed, 400, …): definitive.
            setStatus('error');
            setMessage(errorLabel(payload.error));
            setUploadingSize(null);
            setRetryAttempt(null);
            return;
          }
          setStatus('success');
          setMessage(null);
          setUploadingSize(null);
          setRetryAttempt(null);
          if (inputRef.current) inputRef.current.value = '';
          router.refresh();
          return;
        } catch (err) {
          console.error(
            `[ProofUploader] fetch failed (attempt ${attempt}/${MAX_UPLOAD_ATTEMPTS})`,
            err,
          );
          if (attempt < MAX_UPLOAD_ATTEMPTS) {
            // Wait for the network to settle, then retry.
            setRetryAttempt(attempt + 1);
            setStatus('retrying');
            setMessage(null);
            await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 3000);
            continue;
          }
          // Every attempt failed on the network — calm, definitive error.
          setStatus('error');
          setMessage('Connexion instable, réessaie plus tard.');
          setUploadingSize(null);
          setRetryAttempt(null);
          return;
        }
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

  // Busy = actively sending or waiting out a network backoff. Locks the inputs
  // in both states so a second file can't race an in-flight retry.
  const isBusy = status === 'uploading' || status === 'retrying';

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="t-eyebrow text-[var(--t-3)]">Compte concerné (optionnel)</span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={isBusy}
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
            disabled={isBusy}
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
          disabled={isBusy}
          aria-invalid={message ? 'true' : undefined}
          aria-describedby={[hintId, message ? errorId : null].filter(Boolean).join(' ')}
        />

        {isBusy ? (
          <>
            <div className="grid h-12 w-12 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
              <Spinner
                size={20}
                label={status === 'retrying' ? 'En attente du réseau' : 'Envoi en cours'}
              />
            </div>
            <div className="flex flex-col items-center gap-1">
              {status === 'retrying' ? (
                <>
                  <span className="t-body text-[var(--t-2)]">Connexion instable, on réessaie.</span>
                  <span className="t-cap text-[var(--t-4)]">
                    {retryAttempt !== null
                      ? `Nouvelle tentative ${retryAttempt} sur ${MAX_UPLOAD_ATTEMPTS}, ne ferme pas cette page.`
                      : 'Ne ferme pas cette page.'}
                  </span>
                </>
              ) : (
                <>
                  <span className="t-body text-[var(--t-2)]">
                    Envoi en cours, ne ferme pas encore cette page.
                  </span>
                  {uploadingSize !== null ? (
                    <span className="t-cap text-[var(--t-4)]">
                      {formatFileSize(uploadingSize)} en cours de transfert
                    </span>
                  ) : null}
                </>
              )}
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
        isPdfError ? (
          // J4.3/J4.4 — dedicated PDF block: calm message + guide trigger.
          <div id={errorId} role="alert" className="flex flex-col items-start gap-2">
            <p className="inline-flex items-start gap-1.5 text-[11px] leading-[1.5] text-[var(--bad)]">
              <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span>{message}</span>
            </p>
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              aria-haspopup="dialog"
              className="rounded-control inline-flex min-h-9 items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-[var(--acc)] underline decoration-[var(--b-acc)] underline-offset-2 transition-colors hover:text-[var(--acc-hi)] hover:decoration-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            >
              Comment faire une capture ?
            </button>
          </div>
        ) : (
          <p
            id={errorId}
            role="alert"
            className="inline-flex items-center gap-1.5 text-[11px] text-[var(--bad)]"
          >
            {message}
          </p>
        )
      ) : null}

      <CaptureGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}
