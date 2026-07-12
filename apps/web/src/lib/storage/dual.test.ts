import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DualWriteStorageAdapter } from './dual';
import { StorageError, type UploadInput } from './types';

const mocks = vi.hoisted(() => ({
  localPut: vi.fn(),
  localGetReadUrl: vi.fn(),
  localDelete: vi.fn(),
  putObjectToR2: vi.fn(),
  deleteObjectFromR2: vi.fn(),
  logAudit: vi.fn(),
  reportWarning: vi.fn(),
}));

vi.mock('./local', () => ({
  LocalStorageAdapter: class {
    readonly id = 'local';
    put = mocks.localPut;
    getReadUrl = mocks.localGetReadUrl;
    delete = mocks.localDelete;
  },
}));

vi.mock('./r2', () => ({
  putObjectToR2: mocks.putObjectToR2,
  deleteObjectFromR2: mocks.deleteObjectFromR2,
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: mocks.logAudit }));

vi.mock('@/lib/observability', () => ({ reportWarning: mocks.reportWarning }));

const KEY = 'trades/user1234abcd/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg';

const input: UploadInput = {
  kind: 'trade-entry',
  pathOwner: 'user1234abcd',
  contentType: 'image/jpeg',
  bytes: new Uint8Array([0xff, 0xd8, 0xff]),
};

describe('DualWriteStorageAdapter (J1 — local primary + R2 mirror)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.localPut.mockResolvedValue({ key: KEY, readUrl: `/api/uploads/${KEY}` });
    mocks.localGetReadUrl.mockReturnValue(`/api/uploads/${KEY}`);
    mocks.localDelete.mockResolvedValue(undefined);
    mocks.putObjectToR2.mockResolvedValue(undefined);
    mocks.deleteObjectFromR2.mockResolvedValue(undefined);
    mocks.logAudit.mockResolvedValue(undefined);
  });

  it('exposes the dual adapter id', () => {
    expect(new DualWriteStorageAdapter().id).toBe('dual');
  });

  describe('put', () => {
    it('writes local first, mirrors the SAME key to R2, journals success', async () => {
      const adapter = new DualWriteStorageAdapter();
      const result = await adapter.put(input);

      expect(result).toEqual({ key: KEY, readUrl: `/api/uploads/${KEY}` });
      expect(mocks.localPut).toHaveBeenCalledWith(input);
      expect(mocks.putObjectToR2).toHaveBeenCalledWith(KEY, input.bytes, input.contentType);
      expect(mocks.logAudit).toHaveBeenCalledWith({
        action: 'storage.r2_mirror.succeeded',
        metadata: { key: KEY, stage: 'put' },
      });
      expect(mocks.reportWarning).not.toHaveBeenCalled();
    });

    it('🚨 mirror failure NEVER blocks the upload — warns Sentry + journals failure', async () => {
      mocks.putObjectToR2.mockRejectedValue(new Error('bucket down'));
      const adapter = new DualWriteStorageAdapter();

      const result = await adapter.put(input);

      expect(result).toEqual({ key: KEY, readUrl: `/api/uploads/${KEY}` });
      expect(mocks.reportWarning).toHaveBeenCalledWith('storage.r2_mirror', 'mirror_put_failed', {
        key: KEY,
        message: 'bucket down',
      });
      expect(mocks.logAudit).toHaveBeenCalledWith({
        action: 'storage.r2_mirror.failed',
        metadata: { key: KEY, stage: 'put' },
      });
    });

    it('stringifies a non-Error mirror throw into the Sentry warning', async () => {
      mocks.putObjectToR2.mockRejectedValue('boom');
      const adapter = new DualWriteStorageAdapter();

      await adapter.put(input);

      expect(mocks.reportWarning).toHaveBeenCalledWith('storage.r2_mirror', 'mirror_put_failed', {
        key: KEY,
        message: 'boom',
      });
    });

    it('propagates a local (primary) failure and never touches the mirror', async () => {
      mocks.localPut.mockRejectedValue(new StorageError('disk full', 'internal'));
      const adapter = new DualWriteStorageAdapter();

      await expect(adapter.put(input)).rejects.toThrow(StorageError);
      expect(mocks.putObjectToR2).not.toHaveBeenCalled();
      expect(mocks.logAudit).not.toHaveBeenCalled();
      expect(mocks.reportWarning).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes local first, mirrors the delete to R2, journals success', async () => {
      const adapter = new DualWriteStorageAdapter();
      await adapter.delete(KEY);

      expect(mocks.localDelete).toHaveBeenCalledWith(KEY);
      expect(mocks.deleteObjectFromR2).toHaveBeenCalledWith(KEY);
      expect(mocks.logAudit).toHaveBeenCalledWith({
        action: 'storage.r2_mirror.succeeded',
        metadata: { key: KEY, stage: 'delete' },
      });
    });

    it('mirror delete failure does not block — warns Sentry + journals failure', async () => {
      mocks.deleteObjectFromR2.mockRejectedValue(new Error('r2 timeout'));
      const adapter = new DualWriteStorageAdapter();

      await expect(adapter.delete(KEY)).resolves.toBeUndefined();
      expect(mocks.reportWarning).toHaveBeenCalledWith(
        'storage.r2_mirror',
        'mirror_delete_failed',
        { key: KEY, message: 'r2 timeout' },
      );
      expect(mocks.logAudit).toHaveBeenCalledWith({
        action: 'storage.r2_mirror.failed',
        metadata: { key: KEY, stage: 'delete' },
      });
    });

    it('propagates a local delete failure and never touches the mirror', async () => {
      mocks.localDelete.mockRejectedValue(new StorageError('local delete failed', 'internal'));
      const adapter = new DualWriteStorageAdapter();

      await expect(adapter.delete(KEY)).rejects.toThrow(StorageError);
      expect(mocks.deleteObjectFromR2).not.toHaveBeenCalled();
    });
  });

  describe('getReadUrl', () => {
    it('delegates to the local adapter (reads keep flowing through the gated route)', () => {
      const adapter = new DualWriteStorageAdapter();
      expect(adapter.getReadUrl(KEY)).toBe(`/api/uploads/${KEY}`);
      expect(mocks.localGetReadUrl).toHaveBeenCalledWith(KEY);
    });
  });
});
