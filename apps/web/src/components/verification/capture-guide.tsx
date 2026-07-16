'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * J4.4 — MT5 capture mini-guide (bottom-sheet).
 *
 * Shown when a member is about to upload the wrong thing (e.g. a PDF export
 * caught by the client-side `%PDF` sniff in `<ProofUploader>`), or on demand
 * via the "Comment faire une capture ?" trigger. Three calm, illustrated
 * steps — platform-agnostic for opening the history and re-uploading, with the
 * only real divergence (the screenshot key-combo) split iOS vs Android.
 *
 * Controlled by the parent so the uploader can open it programmatically the
 * moment a PDF is detected. A11y is delegated to the Radix-Dialog-based
 * `<Sheet>` primitive (focus-trap, Escape-to-close, aria-modal, focus-return,
 * scroll-lock) — the same primitive audited in prod for `<AnnotateTradeButton>`
 * and `<LogExpressFab>`. `<SheetTitle>` + `<SheetDescription>` give the dialog
 * its accessible name/description. Illustrations are tiny inline SVG (no
 * external asset): `currentColor` line-art with the pressed elements promoted
 * to the accent via a nested `color`-overriding group (robust cross-browser,
 * avoids the WebView `var()`-in-attribute pitfall).
 *
 * Posture (SPEC §2, Mark Douglas): a mirror, not a scold — "on a juste besoin
 * d'une image", never a reprimand for exporting a PDF.
 */

interface CaptureGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CaptureGuide({ open, onOpenChange }: CaptureGuideProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton
        className="rounded-t-card max-h-[88dvh] overflow-y-auto border-x-0 border-t border-b-0 border-[var(--b-default)] bg-[var(--bg-1)] pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="t-h2 text-[var(--t-1)]">Comment faire une capture ?</SheetTitle>
          <SheetDescription className="t-body text-[var(--t-3)]">
            3 étapes pour envoyer ton historique MT5 en image, sur iPhone comme sur Android.
          </SheetDescription>
        </SheetHeader>

        <ol className="flex flex-col gap-5 px-4 pt-4 pb-2">
          {/* Step 1 — open the MT5 history tab (same on both platforms) */}
          <li className="flex gap-3">
            <StepBadge n={1} />
            <div className="flex flex-1 flex-col gap-2">
              <h3 className="t-h3 text-[var(--t-1)]">Ouvre l’onglet « Historique » de MT5</h3>
              <p className="t-cap text-[var(--t-3)]">
                Dans MetaTrader 5, va sur l’onglet « Historique » pour afficher tes trades passés.
              </p>
              <Illustration>
                <HistorySvg />
              </Illustration>
            </div>
          </li>

          {/* Step 2 — the screenshot key-combo (the only real iOS/Android split) */}
          <li className="flex gap-3">
            <StepBadge n={2} />
            <div className="flex flex-1 flex-col gap-2">
              <h3 className="t-h3 text-[var(--t-1)]">Fais une capture d’écran</h3>
              <p className="t-cap text-[var(--t-3)]">
                Appuie sur les deux boutons en même temps, selon ton téléphone.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <PlatformCard label="iPhone" combo="Bouton latéral + Volume haut">
                  <IosCaptureSvg />
                </PlatformCard>
                <PlatformCard label="Android" combo="Marche/arrêt + Volume bas">
                  <AndroidCaptureSvg />
                </PlatformCard>
              </div>
            </div>
          </li>

          {/* Step 3 — come back and add the image (same on both platforms) */}
          <li className="flex gap-3">
            <StepBadge n={3} />
            <div className="flex flex-1 flex-col gap-2">
              <h3 className="t-h3 text-[var(--t-1)]">Reviens ici et ajoute l’image</h3>
              <p className="t-cap text-[var(--t-3)]">
                Reviens sur cette page, puis sélectionne la capture depuis ta galerie photo.
              </p>
              <Illustration>
                <UploadSvg />
              </Illustration>
            </div>
          </li>
        </ol>
      </SheetContent>
    </Sheet>
  );
}

/** Numbered step marker. */
function StepBadge({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[13px] font-semibold text-[var(--acc)]"
    >
      {n}
    </span>
  );
}

/** Full-width illustration frame (steps 1 & 3). */
function Illustration({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card mt-1 flex items-center justify-center border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-4 text-[var(--t-3)]">
      {children}
    </div>
  );
}

/** One platform card (step 2) with its device illustration + key-combo. */
function PlatformCard({
  label,
  combo,
  children,
}: {
  label: string;
  combo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card flex flex-col items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-3 text-center text-[var(--t-3)]">
      <span className="t-eyebrow-lg text-[var(--t-2)]">{label}</span>
      {children}
      <span className="t-cap text-[var(--t-4)]">{combo}</span>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Inline SVG illustrations. Base line-art uses `currentColor` (inherits the
 * wrapper's muted text color); pressed buttons / selected tab are promoted to
 * the accent via a nested `<g style={{ color: 'var(--acc)' }}>` so the accent
 * comes through `currentColor` — no `var()` inside a presentation attribute.
 * ------------------------------------------------------------------------ */

const ACCENT = { color: 'var(--acc)' } as const;

/** Step 1 — a phone showing the MT5 history tab (accent) + trade rows. */
function HistorySvg() {
  return (
    <svg viewBox="0 0 64 64" width="72" height="72" fill="none" aria-hidden focusable="false">
      <rect x="18" y="5" width="28" height="54" rx="5" stroke="currentColor" strokeWidth="2" />
      {/* selected "Historique" tab */}
      <g style={ACCENT}>
        <rect x="22" y="10" width="20" height="7" rx="2" stroke="currentColor" strokeWidth="2" />
      </g>
      {/* trade rows */}
      <line
        x1="23"
        y1="26"
        x2="41"
        y2="26"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="23"
        y1="33"
        x2="41"
        y2="33"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="23"
        y1="40"
        x2="41"
        y2="40"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="23"
        y1="47"
        x2="35"
        y2="47"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Step 2 (iOS) — side button (right) + volume up (left), both pressed. */
function IosCaptureSvg() {
  return (
    <svg viewBox="0 0 48 64" width="44" height="58" fill="none" aria-hidden focusable="false">
      <rect x="12" y="6" width="24" height="52" rx="6" stroke="currentColor" strokeWidth="2" />
      <rect
        x="15"
        y="10"
        width="18"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.45"
      />
      <g style={ACCENT}>
        {/* volume up — left edge */}
        <line
          x1="12"
          y1="20"
          x2="12"
          y2="28"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* side button — right edge */}
        <line
          x1="36"
          y1="22"
          x2="36"
          y2="32"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/** Step 2 (Android) — power (right) + volume down (right, below), both pressed. */
function AndroidCaptureSvg() {
  return (
    <svg viewBox="0 0 48 64" width="44" height="58" fill="none" aria-hidden focusable="false">
      <rect x="12" y="6" width="24" height="52" rx="6" stroke="currentColor" strokeWidth="2" />
      <rect
        x="15"
        y="10"
        width="18"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.45"
      />
      <g style={ACCENT}>
        {/* power — right edge, upper */}
        <line
          x1="36"
          y1="20"
          x2="36"
          y2="28"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* volume down — right edge, lower */}
        <line
          x1="36"
          y1="33"
          x2="36"
          y2="43"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/** Step 3 — a phone with an image + an up-arrow (accent). */
function UploadSvg() {
  return (
    <svg viewBox="0 0 64 64" width="72" height="72" fill="none" aria-hidden focusable="false">
      <rect x="18" y="5" width="28" height="54" rx="5" stroke="currentColor" strokeWidth="2" />
      {/* image frame */}
      <rect x="24" y="30" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <circle cx="28.5" cy="35" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M25 43l4.5-4 3 2.5 3-3 3.5 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* upward arrow */}
      <g style={ACCENT}>
        <line
          x1="32"
          y1="26"
          x2="32"
          y2="13"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M27 18l5-5 5 5"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
