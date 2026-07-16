// J4.6 — pure `%PDF` magic-byte sniff, extracted from `<ProofUploader>` so the
// check is unit-testable in isolation (no DOM, no `File`). A PDF starts with the
// bytes `25 50 44 46` ("%PDF"); any buffer shorter than 4 bytes cannot match.
//
// Intentionally NO `import 'server-only'`: this runs in the browser (the
// uploader reads `file.slice(0, 5)`) AND in the Vitest suite.

/** True when `bytes` starts with the `%PDF` (`25 50 44 46`) magic header. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}
