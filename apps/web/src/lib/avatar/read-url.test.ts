import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the shared avatar read helpers. `@/lib/storage` is mocked so
 * the URL-resolution branches (key resolves / key throws / no key) are provable
 * without a filesystem, and `@/lib/db` is mocked so `loadSessionAvatar`'s
 * row-shaping is exercised without Postgres.
 */

const m = vi.hoisted(() => ({
  storageGetReadUrl: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  selectStorage: () => ({
    id: 'local' as const,
    getReadUrl: m.storageGetReadUrl,
  }),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: m.userFindUnique },
  },
}));

import { avatarUrlOf, initialsOf, loadSessionAvatar } from './read-url';

beforeEach(() => {
  vi.clearAllMocks();
  m.storageGetReadUrl.mockReturnValue('https://cdn.test/read-url');
});

describe('initialsOf', () => {
  it('joins the first + last initial, uppercased', () => {
    expect(initialsOf('daisy', 'fields')).toBe('DF');
  });

  it('keeps only the first initial when the last name is missing', () => {
    expect(initialsOf('Eliott', null)).toBe('E');
    expect(initialsOf('eliott', '')).toBe('E');
  });

  it('keeps only the last initial when the first name is missing', () => {
    expect(initialsOf(null, 'Pena')).toBe('P');
  });

  it("falls back to '?' when both are null", () => {
    expect(initialsOf(null, null)).toBe('?');
  });

  it("falls back to '?' when both are blank / whitespace", () => {
    expect(initialsOf('   ', '\t')).toBe('?');
    expect(initialsOf('', '')).toBe('?');
  });

  it('trims surrounding whitespace before taking the initial', () => {
    expect(initialsOf('  ana', '  bell')).toBe('AB');
  });
});

describe('avatarUrlOf', () => {
  it('resolves a stored key through storage', () => {
    m.storageGetReadUrl.mockReturnValue('https://cdn.test/avatars/k.webp');
    expect(avatarUrlOf('avatars/k.webp', null)).toBe('https://cdn.test/avatars/k.webp');
    expect(m.storageGetReadUrl).toHaveBeenCalledWith('avatars/k.webp');
  });

  it('falls back to the legacy image when the key is unresolvable (throws)', () => {
    m.storageGetReadUrl.mockImplementation(() => {
      throw new Error('malformed key');
    });
    expect(avatarUrlOf('broken/key', 'https://legacy/image.png')).toBe('https://legacy/image.png');
  });

  it('falls back to null when the key throws and there is no legacy image', () => {
    m.storageGetReadUrl.mockImplementation(() => {
      throw new Error('malformed key');
    });
    expect(avatarUrlOf('broken/key', null)).toBeNull();
  });

  it('uses the legacy image when there is no key at all', () => {
    expect(avatarUrlOf(null, 'https://legacy/image.png')).toBe('https://legacy/image.png');
    expect(m.storageGetReadUrl).not.toHaveBeenCalled();
  });

  it('returns null when neither key nor image is set', () => {
    expect(avatarUrlOf(null, null)).toBeNull();
  });
});

describe('loadSessionAvatar', () => {
  it('shapes a member with a stored key into url + initials + firstName', async () => {
    m.storageGetReadUrl.mockReturnValue('https://cdn.test/avatars/u1.webp');
    m.userFindUnique.mockResolvedValue({
      firstName: 'Eliott',
      lastName: 'Pena',
      avatarKey: 'avatars/u1.webp',
      image: null,
    });

    await expect(loadSessionAvatar('u1')).resolves.toEqual({
      url: 'https://cdn.test/avatars/u1.webp',
      initials: 'EP',
      firstName: 'Eliott',
    });
  });

  it('falls back to the legacy image url when no key is set', async () => {
    m.userFindUnique.mockResolvedValue({
      firstName: 'Ana',
      lastName: null,
      avatarKey: null,
      image: 'https://legacy/ana.png',
    });

    await expect(loadSessionAvatar('u2')).resolves.toEqual({
      url: 'https://legacy/ana.png',
      initials: 'A',
      firstName: 'Ana',
    });
    expect(m.storageGetReadUrl).not.toHaveBeenCalled();
  });

  it("defaults firstName to 'Membre' when it is blank", async () => {
    m.userFindUnique.mockResolvedValue({
      firstName: '   ',
      lastName: null,
      avatarKey: null,
      image: null,
    });

    await expect(loadSessionAvatar('u3')).resolves.toEqual({
      url: null,
      initials: '?',
      firstName: 'Membre',
    });
  });

  it('returns null when the user row is gone (deleted mid-session)', async () => {
    m.userFindUnique.mockResolvedValue(null);
    await expect(loadSessionAvatar('missing')).resolves.toBeNull();
  });

  it('looks the user up by primary key with the minimal selection', async () => {
    m.userFindUnique.mockResolvedValue({
      firstName: 'Zoe',
      lastName: 'Kay',
      avatarKey: null,
      image: null,
    });

    await loadSessionAvatar('u4');
    expect(m.userFindUnique).toHaveBeenCalledWith({
      where: { id: 'u4' },
      select: { firstName: true, lastName: true, avatarKey: true, image: true },
    });
  });
});
