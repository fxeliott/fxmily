import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  R2StorageAdapter,
  deleteObjectFromR2,
  openR2ReadStream,
  putObjectToR2,
  resetR2ClientForTests,
} from './r2';
import { StorageError, type UploadInput } from './types';

const h = vi.hoisted(() => {
  const sendMock = vi.fn();
  const clientConfigs: unknown[] = [];
  return { sendMock, clientConfigs };
});

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = h.sendMock;
    constructor(config: unknown) {
      h.clientConfigs.push(config);
    }
  }
  class PutObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class DeleteObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class NoSuchKey extends Error {
    constructor() {
      super('The specified key does not exist.');
      this.name = 'NoSuchKey';
    }
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, NoSuchKey };
});

const envMock = vi.hoisted(() => ({
  env: {
    R2_ACCOUNT_ID: undefined as string | undefined,
    R2_ACCESS_KEY_ID: undefined as string | undefined,
    R2_SECRET_ACCESS_KEY: undefined as string | undefined,
    R2_BUCKET: undefined as string | undefined,
    R2_ENDPOINT: undefined as string | undefined,
    R2_PUBLIC_URL: undefined as string | undefined,
  },
}));

vi.mock('@/lib/env', () => envMock);

// The mocked NoSuchKey has a zero-arg constructor at runtime; the SDK type
// declares option args, so we construct through a loose alias.
const NoSuchKeyCtor = NoSuchKey as unknown as new () => Error;

const KEY = 'trades/user1234abcd/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg';
const BYTES = new Uint8Array([0xff, 0xd8, 0xff]);

function sentCommand(index = 0): { input: Record<string, unknown> } {
  const call = h.sendMock.mock.calls[index];
  if (!call) throw new Error(`send call #${index} was never made`);
  return call[0] as { input: Record<string, unknown> };
}

function clientConfig(index = 0): Record<string, unknown> {
  const config = h.clientConfigs[index];
  if (!config) throw new Error(`S3Client construction #${index} never happened`);
  return config as Record<string, unknown>;
}

beforeEach(() => {
  h.sendMock.mockReset();
  h.clientConfigs.length = 0;
  envMock.env.R2_ACCOUNT_ID = 'test-account';
  envMock.env.R2_ACCESS_KEY_ID = 'test-access-key';
  envMock.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  envMock.env.R2_BUCKET = 'test-bucket';
  envMock.env.R2_ENDPOINT = undefined;
  envMock.env.R2_PUBLIC_URL = undefined;
  resetR2ClientForTests();
});

describe('putObjectToR2', () => {
  it('sends a PutObjectCommand with bucket, key, body, content-type and PRIVATE immutable cache', async () => {
    h.sendMock.mockResolvedValue({});

    await putObjectToR2(KEY, BYTES, 'image/jpeg');

    expect(h.sendMock).toHaveBeenCalledTimes(1);
    const command = sentCommand();
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'test-bucket',
      Key: KEY,
      Body: BYTES,
      ContentType: 'image/jpeg',
      CacheControl: 'private, max-age=31536000, immutable',
    });
  });

  it('🚨 rejects a malformed key BEFORE any network call', async () => {
    await expect(putObjectToR2('../etc/passwd', BYTES, 'image/jpeg')).rejects.toMatchObject({
      name: 'StorageError',
      code: 'invalid_key',
    });
    expect(h.sendMock).not.toHaveBeenCalled();
  });

  it('fails closed with an internal StorageError when R2 env is missing', async () => {
    envMock.env.R2_ACCOUNT_ID = undefined;

    await expect(putObjectToR2(KEY, BYTES, 'image/jpeg')).rejects.toMatchObject({
      name: 'StorageError',
      code: 'internal',
      message: 'R2_ACCOUNT_ID is not configured',
    });
    expect(h.sendMock).not.toHaveBeenCalled();
  });

  it('wraps SDK failures into an internal StorageError', async () => {
    h.sendMock.mockRejectedValue(new Error('socket hang up'));

    await expect(putObjectToR2(KEY, BYTES, 'image/jpeg')).rejects.toMatchObject({
      name: 'StorageError',
      code: 'internal',
      message: 'r2 put failed: socket hang up',
    });
  });
});

describe('deleteObjectFromR2', () => {
  it('sends a DeleteObjectCommand for the key', async () => {
    h.sendMock.mockResolvedValue({});

    await deleteObjectFromR2(KEY);

    const command = sentCommand();
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({ Bucket: 'test-bucket', Key: KEY });
  });

  it('rejects a malformed key before any network call', async () => {
    await expect(deleteObjectFromR2('proofs/../x.jpg')).rejects.toMatchObject({
      name: 'StorageError',
      code: 'invalid_key',
    });
    expect(h.sendMock).not.toHaveBeenCalled();
  });
});

describe('openR2ReadStream', () => {
  const webStream = Symbol('web-stream');

  it('returns the web stream, size and ext on success', async () => {
    h.sendMock.mockResolvedValue({
      Body: { transformToWebStream: () => webStream },
      ContentLength: 1234,
    });

    const result = await openR2ReadStream(KEY);

    const command = sentCommand();
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({ Bucket: 'test-bucket', Key: KEY });
    expect(result.stream).toBe(webStream);
    expect(result.size).toBe(1234);
    expect(result.ext).toBe('jpg');
  });

  it('returns size null when R2 omits Content-Length', async () => {
    h.sendMock.mockResolvedValue({
      Body: { transformToWebStream: () => webStream },
    });

    const result = await openR2ReadStream(KEY);
    expect(result.size).toBeNull();
  });

  it('maps NoSuchKey to StorageError not_found', async () => {
    h.sendMock.mockRejectedValue(new NoSuchKeyCtor());

    await expect(openR2ReadStream(KEY)).rejects.toMatchObject({
      name: 'StorageError',
      code: 'not_found',
    });
  });

  it('maps an error named NotFound to StorageError not_found', async () => {
    const err = new Error('missing');
    err.name = 'NotFound';
    h.sendMock.mockRejectedValue(err);

    await expect(openR2ReadStream(KEY)).rejects.toMatchObject({
      name: 'StorageError',
      code: 'not_found',
    });
  });

  it('wraps other SDK failures into an internal StorageError', async () => {
    h.sendMock.mockRejectedValue(new Error('timeout'));

    await expect(openR2ReadStream(KEY)).rejects.toMatchObject({
      name: 'StorageError',
      code: 'internal',
      message: 'r2 get failed: timeout',
    });
  });

  it('fails with internal when the response has no Body', async () => {
    h.sendMock.mockResolvedValue({ ContentLength: 10 });

    await expect(openR2ReadStream(KEY)).rejects.toMatchObject({
      name: 'StorageError',
      code: 'internal',
      message: 'r2 object has no body',
    });
  });
});

describe('getR2Client wiring', () => {
  it('derives the canonical account endpoint with region auto + path style + env credentials', async () => {
    h.sendMock.mockResolvedValue({});

    await putObjectToR2(KEY, BYTES, 'image/jpeg');

    const config = clientConfig();
    expect(config['region']).toBe('auto');
    expect(config['endpoint']).toBe('https://test-account.r2.cloudflarestorage.com');
    expect(config['forcePathStyle']).toBe(true);
    expect(config['credentials']).toEqual({
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
    });
  });

  it('honours the R2_ENDPOINT override (MinIO dev/test)', async () => {
    envMock.env.R2_ENDPOINT = 'http://127.0.0.1:9000';
    h.sendMock.mockResolvedValue({});

    await putObjectToR2(KEY, BYTES, 'image/jpeg');

    expect(clientConfig()['endpoint']).toBe('http://127.0.0.1:9000');
  });

  it('caches the client across calls and resetR2ClientForTests drops it', async () => {
    h.sendMock.mockResolvedValue({});

    await putObjectToR2(KEY, BYTES, 'image/jpeg');
    await deleteObjectFromR2(KEY);
    expect(h.clientConfigs).toHaveLength(1);

    resetR2ClientForTests();
    await putObjectToR2(KEY, BYTES, 'image/jpeg');
    expect(h.clientConfigs).toHaveLength(2);
  });
});

describe('R2StorageAdapter', () => {
  const input: UploadInput = {
    kind: 'trade-entry',
    pathOwner: 'user1234abcd',
    contentType: 'image/jpeg',
    bytes: BYTES,
  };

  it('exposes the r2 adapter id', () => {
    expect(new R2StorageAdapter().id).toBe('r2');
  });

  it('put mints a key via the SHARED generateKeyForUpload and uploads to it', async () => {
    h.sendMock.mockResolvedValue({});
    const adapter = new R2StorageAdapter();

    const result = await adapter.put(input);

    expect(result.key).toMatch(/^trades\/user1234abcd\/[a-zA-Z0-9_-]{32}\.jpg$/);
    const command = sentCommand();
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input['Key']).toBe(result.key);
    expect(result.readUrl).toBe(`/api/uploads/${result.key}`);
  });

  it('getReadUrl defaults to the auth-gated uploads route', () => {
    expect(new R2StorageAdapter().getReadUrl(KEY)).toBe(`/api/uploads/${KEY}`);
  });

  it('getReadUrl uses R2_PUBLIC_URL when set, trimming the trailing slash', () => {
    envMock.env.R2_PUBLIC_URL = 'https://media.example.com/';
    expect(new R2StorageAdapter().getReadUrl(KEY)).toBe(`https://media.example.com/${KEY}`);
  });

  it('getReadUrl validates the key before exposing anything', () => {
    expect(() => new R2StorageAdapter().getReadUrl('../etc/passwd')).toThrow(StorageError);
  });

  it('delete sends a DeleteObjectCommand', async () => {
    h.sendMock.mockResolvedValue({});

    await new R2StorageAdapter().delete(KEY);

    const command = sentCommand();
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({ Bucket: 'test-bucket', Key: KEY });
  });
});
