'use client';

import { Check, Loader2, Move, X, ZoomIn } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

/**
 * `<AvatarCropEditor>` — position + zoom the profile photo before upload.
 *
 * Answers "modifier l'emplacement et le zoom de la pp": the member picks any
 * file, frames their face inside the circle (drag OR arrow keys to move, the
 * slider to zoom), and confirms. On confirm we paint the framed region onto a
 * 512×512 canvas and export a clean WebP blob — so the upload is ALWAYS a small,
 * canonical image regardless of the source format. That doubles as the
 * "tout type de fichier accepté" solution: anything the browser can render
 * (JPEG/PNG/WebP/GIF/AVIF, and HEIC on Apple devices) is re-encoded here; a file
 * the browser cannot decode fires `onDecodeError` so the caller shows an
 * actionable message instead of a silent failure.
 *
 * The picked image is handed in as `previewUrl`, an object URL the PARENT owns
 * and revokes. We deliberately do NOT create it here: `URL.createObjectURL`
 * during render is discouraged, and a passive revoke effect would fire on React
 * Strict Mode's simulated unmount (dev) and orphan the still-displayed blob
 * (ERR_FILE_NOT_FOUND). Keeping creation/revocation in the parent's event
 * handlers makes the lifetime explicit and Strict-Mode-safe.
 *
 * Pure client, no dependency. Accessible: the zoom is a native labelled slider,
 * the frame is keyboard-repositionable with the arrow keys (a non-drag single
 * pointer alternative — WCAG 2.5.7), motion is non-essential (reduced-motion
 * safe). The circle is a DISPLAY mask only; the exported image is square 512²,
 * exactly what the server stores, so what the member frames is what everyone
 * sees on the leaderboard.
 */

/** Editor viewport edge in CSS px — fixed so the pan/zoom math is exact and it
 *  fits a 390px mobile viewport with padding. */
const VIEWPORT_PX = 256;
/** Exported avatar edge — matches the server's canonical `AVATAR_SIZE_PX`. */
const EXPORT_PX = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
/** Arrow-key nudge in viewport px (keyboard reposition = drag alternative). */
const KEY_NUDGE_PX = 12;

interface AvatarCropEditorProps {
  /** Object URL for the picked file, created AND revoked by the parent. */
  previewUrl: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
  /** The browser could not decode this file (e.g. HEIC on desktop Chrome). */
  onDecodeError: () => void;
}

interface NaturalSize {
  w: number;
  h: number;
}

export function AvatarCropEditor({
  previewUrl,
  busy = false,
  onCancel,
  onConfirm,
  onDecodeError,
}: AvatarCropEditorProps): React.ReactElement {
  const [natural, setNatural] = useState<NaturalSize | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [exporting, setExporting] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  // Reset the frame when a NEW image arrives (previewUrl is 1:1 with the file) —
  // the officially-supported "adjust state while rendering on a prop change"
  // pattern (react.dev/reference/react/useState#storing-information-from-previous-
  // renders): compare against a state copy of the previous URL, so no effect and
  // no ref written during render.
  const [prevUrl, setPrevUrl] = useState(previewUrl);
  if (prevUrl !== previewUrl) {
    setPrevUrl(previewUrl);
    setNatural(null);
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }

  // Cover-fit scale at zoom 1: the smaller image dimension fills the square, so
  // the frame is always fully covered (no empty gap) at any pan.
  const baseScale = natural ? Math.max(VIEWPORT_PX / natural.w, VIEWPORT_PX / natural.h) : 1;
  const scale = baseScale * zoom;
  const displayedW = natural ? natural.w * scale : VIEWPORT_PX;
  const displayedH = natural ? natural.h * scale : VIEWPORT_PX;

  const clampPan = useCallback((x: number, y: number, dW: number, dH: number) => {
    const mx = Math.max(0, (dW - VIEWPORT_PX) / 2);
    const my = Math.max(0, (dH - VIEWPORT_PX) / 2);
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  }, []);
  // Convenience closure over the CURRENT displayed size (drag + arrow keys).
  const clamp = useCallback(
    (x: number, y: number) => clampPan(x, y, displayedW, displayedH),
    [clampPan, displayedW, displayedH],
  );

  // Re-clamp on zoom change here (not in an effect): a zoom-out shrinks the
  // reachable pan range, so recompute against the NEW displayed size.
  function onZoomChange(next: number): void {
    setZoom(next);
    if (!natural) return;
    const s = baseScale * next;
    setPan((p) => clampPan(p.x, p.y, natural.w * s, natural.h * s));
  }

  const left = VIEWPORT_PX / 2 - displayedW / 2 + pan.x;
  const top = VIEWPORT_PX / 2 - displayedH / 2 + pan.y;

  function onPointerDown(e: React.PointerEvent): void {
    if (busy || exporting || !natural) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent): void {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setPan((p) => clamp(p.x + dx, p.y + dy));
  }
  function endDrag(e: React.PointerEvent): void {
    if (drag.current?.id === e.pointerId) drag.current = null;
  }
  function onKeyDown(e: React.KeyboardEvent): void {
    if (busy || exporting) return;
    const step = KEY_NUDGE_PX;
    if (e.key === 'ArrowLeft') setPan((p) => clamp(p.x + step, p.y));
    else if (e.key === 'ArrowRight') setPan((p) => clamp(p.x - step, p.y));
    else if (e.key === 'ArrowUp') setPan((p) => clamp(p.x, p.y + step));
    else if (e.key === 'ArrowDown') setPan((p) => clamp(p.x, p.y - step));
    else return;
    e.preventDefault();
  }

  function handleConfirm(): void {
    const img = imgRef.current;
    if (!img || !natural || busy || exporting) return;
    setExporting(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = EXPORT_PX;
      canvas.height = EXPORT_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setExporting(false);
        onDecodeError();
        return;
      }
      const k = EXPORT_PX / VIEWPORT_PX; // viewport px → canvas px
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, left * k, top * k, displayedW * k, displayedH * k);
      const finish = (blob: Blob | null): void => {
        setExporting(false);
        if (blob) onConfirm(blob);
        else onDecodeError();
      };
      // WebP first (smallest); fall back to PNG on a browser without WebP export.
      canvas.toBlob(
        (blob) => (blob ? finish(blob) : canvas.toBlob(finish, 'image/png')),
        'image/webp',
        0.9,
      );
    } catch {
      setExporting(false);
      onDecodeError();
    }
  }

  const working = busy || exporting;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3">
        {/* The framing viewport — circle mask (display only), drag/keys to move. */}
        <div
          role="group"
          aria-label="Cadrer la photo : fais glisser ou utilise les flèches pour déplacer, le curseur pour zoomer"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className="relative touch-none overflow-hidden rounded-full border border-[var(--b-acc)] bg-[var(--bg-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          style={{ width: VIEWPORT_PX, height: VIEWPORT_PX, cursor: working ? 'default' : 'grab' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={previewUrl}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget;
              // A file the browser "loads" but decodes to zero intrinsic size
              // (an SVG with no width/height, a corrupt raster) fires onLoad, NOT
              // onError. Left unguarded it makes baseScale Infinity → NaN crop
              // coords → `ctx.drawImage` is a silent spec no-op → we would export
              // a BLANK 512² WebP and cheerfully report "Photo enregistrée". Treat
              // it as undecodable so the caller shows the actionable message.
              if (el.naturalWidth === 0 || el.naturalHeight === 0) {
                onDecodeError();
                return;
              }
              setNatural({ w: el.naturalWidth, h: el.naturalHeight });
            }}
            onError={onDecodeError}
            className="pointer-events-none absolute max-w-none select-none"
            style={{ left, top, width: displayedW, height: displayedH }}
          />
          {/* Center ring guide — reinforces where the face should sit. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-[var(--b-subtle)] ring-inset"
          />
          {!natural ? (
            <span className="absolute inset-0 grid place-items-center text-[var(--t-3)]">
              <Loader2
                className="h-5 w-5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            </span>
          ) : null}
        </div>

        <p className="inline-flex items-center gap-1.5 text-[11px] text-[var(--t-4)]">
          <Move className="h-3.5 w-3.5" aria-hidden="true" />
          Glisse pour déplacer, zoome avec le curseur
        </p>
      </div>

      {/* Zoom slider — native, keyboard-operable, labelled. */}
      <label className="flex items-center gap-3">
        <ZoomIn className="h-4 w-4 shrink-0 text-[var(--t-3)]" aria-hidden="true" />
        <span className="sr-only">Zoom</span>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          disabled={working || !natural}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          aria-label="Zoom de la photo"
          aria-valuetext={`Zoom ${Math.round(zoom * 100)} %`}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--bg-3)] accent-[var(--acc)] disabled:opacity-50"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={working || !natural}
          className="rounded-control inline-flex h-10 flex-1 items-center justify-center gap-2 border border-[var(--b-acc)] bg-[var(--acc-btn)] px-3.5 text-[13px] font-medium text-[var(--acc-fg)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] disabled:opacity-60"
        >
          {working ? (
            <Loader2
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Check className="h-4 w-4" aria-hidden="true" />
          )}
          Utiliser cette photo
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={working}
          className="rounded-control inline-flex h-10 items-center justify-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] px-3.5 text-[13px] font-medium text-[var(--t-2)] transition hover:border-[var(--b-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] disabled:opacity-60"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Annuler
        </button>
      </div>
    </div>
  );
}
