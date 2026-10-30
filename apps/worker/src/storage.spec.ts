import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkerEnv } from './env';
import { createStorage, LocalObjectStorage, RoutedObjectStorage } from './storage';

function env(overrides: Record<string, unknown>): WorkerEnv {
  return {
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_ROOT: './.data/uploads',
    S3_ENDPOINT: '',
    S3_REGION: 'us-east-1',
    S3_BUCKET: '',
    S3_ACCESS_KEY_ID: '',
    S3_SECRET_ACCESS_KEY: '',
    S3_FORCE_PATH_STYLE: true,
    ...overrides,
  } as unknown as WorkerEnv;
}

describe('createStorage', () => {
  it('uses the local driver for local development', () => {
    expect(createStorage(env({}))).toBeInstanceOf(RoutedObjectStorage);
  });

  it('uses S3 when the API and worker are configured for object storage', () => {
    expect(
      createStorage(
        env({
          STORAGE_DRIVER: 's3',
          S3_ENDPOINT: 'http://localhost:9000',
          S3_BUCKET: 'catalog',
          S3_ACCESS_KEY_ID: 'key',
          S3_SECRET_ACCESS_KEY: 'secret',
        }),
      ),
    ).toBeInstanceOf(RoutedObjectStorage);
  });

  it('refuses an incomplete S3 configuration instead of deleting local files', () => {
    expect(() => createStorage(env({ STORAGE_DRIVER: 's3' }))).toThrow(
      /STORAGE_DRIVER=s3 requires/,
    );
  });

  it('physically removes a local object and makes repeated deletion idempotent', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'b2b-worker-storage-'));
    const storage = new LocalObjectStorage(root);
    const key = 'quote-template/2026/10/template.xlsx';

    try {
      await storage.put(key, Buffer.from('private workbook'), 'application/octet-stream');
      expect(await storage.exists(key)).toBe(true);

      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);

      await expect(storage.delete(key)).resolves.toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
