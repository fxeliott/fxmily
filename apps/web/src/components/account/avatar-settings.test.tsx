// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AvatarSettings } from './avatar-settings';

/**
 * AvatarSettings — the HEIC wiring. We mock the client HEIC helper (its own unit
 * test covers detection/conversion) and assert the STATE MACHINE around it:
 *  - a normal image opens the crop editor directly (no conversion),
 *  - an iPhone HEIC shows the "conversion" status then opens the editor with the
 *    converted file,
 *  - a conversion failure surfaces one honest error and opens nothing.
 */

const { isHeicFile, convertHeicToJpeg } = vi.hoisted(() => ({
  isHeicFile: vi.fn(),
  convertHeicToJpeg: vi.fn(),
}));
vi.mock('@/lib/uploads/heic.client', () => ({ isHeicFile, convertHeicToJpeg }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function pickFile(name: string, type: string): void {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not rendered');
  const file = new File([new Uint8Array([1, 2, 3])], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderSettings() {
  return render(<AvatarSettings initialUrl={null} initials="EP" firstName="Eliott" />);
}

describe('AvatarSettings — HEIC wiring', () => {
  it('opens the crop editor directly for a normal JPEG (no conversion)', async () => {
    isHeicFile.mockResolvedValue(false);
    renderSettings();
    pickFile('photo.jpg', 'image/jpeg');

    // The crop editor (its framing group) mounts once the object URL is set.
    await waitFor(() => {
      expect(screen.getByRole('group', { name: /cadrer la photo/i })).toBeInTheDocument();
    });
    expect(convertHeicToJpeg).not.toHaveBeenCalled();
    expect(screen.queryByText(/conversion de la photo iphone/i)).not.toBeInTheDocument();
  });

  it('shows the conversion status for a HEIC, then opens the editor', async () => {
    isHeicFile.mockResolvedValue(true);
    // Defer the conversion so the intermediate "converting" render is observable.
    let resolveConvert!: (f: File) => void;
    convertHeicToJpeg.mockImplementation(() => new Promise<File>((res) => (resolveConvert = res)));
    renderSettings();
    pickFile('IMG_1234.HEIC', '');

    // Converting status visible + editor not open yet.
    expect(await screen.findByText(/conversion de la photo iphone/i)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /cadrer la photo/i })).not.toBeInTheDocument();

    // Conversion completes → editor opens, status clears.
    resolveConvert(new File([new Uint8Array([9])], 'IMG_1234.jpg', { type: 'image/jpeg' }));
    await waitFor(() => {
      expect(screen.getByRole('group', { name: /cadrer la photo/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/conversion de la photo iphone/i)).not.toBeInTheDocument();
  });

  it('surfaces an honest error and opens nothing when conversion fails', async () => {
    isHeicFile.mockResolvedValue(true);
    convertHeicToJpeg.mockRejectedValue(new Error('decode failed'));
    renderSettings();
    pickFile('IMG_1234.HEIC', '');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/n.a pas pu être convertie/i);
    expect(screen.queryByRole('group', { name: /cadrer la photo/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/conversion de la photo iphone/i)).not.toBeInTheDocument();
  });
});
