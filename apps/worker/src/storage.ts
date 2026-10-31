import { createHash, createHmac } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { PassThrough, Readable as NodeReadable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { storageVisibilityForKey, type StorageVisibility } from '@b2b/contracts';
import type { WorkerEnv } from './env';

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  putFile?(key: string, path: string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  readStream(key: string): Readable;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export class RoutedObjectStorage implements ObjectStorage {
  constructor(private readonly drivers: Record<StorageVisibility, ObjectStorage>) {}

  private driver(key: string): ObjectStorage {
    return this.drivers[storageVisibilityForKey(key)] ?? this.drivers.private;
  }

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.driver(key).put(key, body, contentType);
  }

  putFile(key: string, path: string, contentType: string): Promise<void> {
    const driver = this.driver(key);
    if (!driver.putFile) throw new Error('storage.put_file_not_supported');
    return driver.putFile(key, path, contentType);
  }

  get(key: string): Promise<Buffer> {
    return this.driver(key).get(key);
  }

  readStream(key: string): Readable {
    return this.driver(key).readStream(key);
  }

  exists(key: string): Promise<boolean> {
    return this.driver(key).exists(key);
  }

  delete(key: string): Promise<void> {
    return this.driver(key).delete(key);
  }
}

// Mirrors the API's local driver. Production deploys set STORAGE_DRIVER=s3; the
// worker then uses the same SigV4 signing path as the API.
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(rootPath: string) {
    this.root = resolve(rootPath);
  }

  private resolveKey(key: string): string {
    const normalized = normalize(key);
    if (normalized.startsWith('..') || normalized.includes(`..${sep}`)) {
      throw new Error('storage.key_traversal');
    }
    const target = resolve(join(this.root, normalized));
    if (!target.startsWith(this.root)) throw new Error('storage.key_outside_root');
    return target;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.resolveKey(key);
    mkdirSync(dirname(target), { recursive: true });
    await fs.writeFile(target, body, { mode: 0o640 });
  }

  async putFile(key: string, path: string): Promise<void> {
    const target = this.resolveKey(key);
    mkdirSync(dirname(target), { recursive: true });
    await fs.copyFile(path, target);
    await fs.chmod(target, 0o640);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveKey(key));
  }

  readStream(key: string): Readable {
    return createReadStream(this.resolveKey(key));
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolveKey(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

interface S3Options {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function amzDate(date: Date): { timestamp: string; shortDate: string } {
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { timestamp, shortDate: timestamp.slice(0, 8) };
}

/**
 * Minimal S3-compatible driver for the worker.
 *
 * The API already writes objects through the same SigV4 implementation; keeping
 * the worker on the exact same storage backend is essential. With a local-only
 * worker in an S3 deployment, `DELETE` would look at a non-existent local file,
 * treat the missing object as an idempotent success and then remove the database
 * row while the real object stayed in the bucket.
 */
export class S3ObjectStorage implements ObjectStorage {
  constructor(private readonly options: S3Options) {}

  private objectUrl(key: string): URL {
    const base = this.options.endpoint.replace(/\/+$/, '');
    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    if (this.options.forcePathStyle) {
      return new URL(`${base}/${this.options.bucket}/${encodedKey}`);
    }
    const url = new URL(base);
    url.hostname = `${this.options.bucket}.${url.hostname}`;
    url.pathname = `/${encodedKey}`;
    return url;
  }

  private sign(
    method: string,
    url: URL,
    payloadHash: string,
    extraHeaders: Record<string, string> = {},
  ): Record<string, string> {
    const { timestamp, shortDate } = amzDate(new Date());
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': timestamp,
      ...extraHeaders,
    };
    const sortedKeys = Object.keys(headers)
      .map((key) => key.toLowerCase())
      .sort();
    const canonicalHeaders = sortedKeys
      .map((key) => `${key}:${headers[key]?.trim().replace(/\s+/g, ' ')}\n`)
      .join('');
    const signedHeaders = sortedKeys.join(';');
    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${shortDate}/${this.options.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256Hex(canonicalRequest)].join(
      '\n',
    );
    // Keep this derivation identical to the API S3 driver:
    // date -> region -> service -> aws4_request.
    const dateKey = createHmac('sha256', `AWS4${this.options.secretAccessKey}`)
      .update(shortDate)
      .digest();
    const regionKey = createHmac('sha256', dateKey).update(this.options.region).digest();
    const serviceKey = createHmac('sha256', regionKey).update('s3').digest();
    const signingKey = createHmac('sha256', serviceKey).update('aws4_request').digest();
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    return {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  private async request(
    method: 'PUT' | 'GET' | 'DELETE' | 'HEAD',
    key: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const url = this.objectUrl(key);
    const payload = body ?? Buffer.alloc(0);
    const payloadHash = sha256Hex(payload);
    const headers = this.sign(
      method,
      url,
      payloadHash,
      contentType ? { 'content-type': contentType } : {},
    );
    return fetch(url, {
      method,
      headers,
      body: method === 'PUT' || method === 'DELETE' ? new Uint8Array(payload) : undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.request('PUT', key, body, contentType);
    if (!response.ok) throw new Error(`storage.s3_put_failed:${response.status}`);
  }

  async putFile(key: string, path: string, contentType: string): Promise<void> {
    const url = this.objectUrl(key);
    const stat = await fs.stat(path);
    const payloadHash = 'UNSIGNED-PAYLOAD';
    const headers = this.sign('PUT', url, payloadHash, {
      'content-type': contentType,
      'content-length': String(stat.size),
    });
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: createReadStream(path),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    if (!response.ok) throw new Error(`storage.s3_put_failed:${response.status}`);
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.request('GET', key);
    if (!response.ok) throw new Error(`storage.s3_get_failed:${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  readStream(key: string): Readable {
    const stream = new PassThrough();
    void (async () => {
      const response = await this.request('GET', key);
      if (!response.ok) throw new Error(`storage.s3_get_failed:${response.status}`);
      if (!response.body) throw new Error('storage.s3_get_empty_body');
      await pipeline(NodeReadable.from(response.body as AsyncIterable<Uint8Array>), stream);
    })().catch((error: unknown) => stream.destroy(error as Error));
    return stream;
  }

  async exists(key: string): Promise<boolean> {
    const response = await this.request('HEAD', key);
    return response.ok;
  }

  async delete(key: string): Promise<void> {
    const response = await this.request('DELETE', key);
    // A missing object is already deleted; this makes retries idempotent.
    if (!response.ok && response.status !== 404) {
      throw new Error(`storage.s3_delete_failed:${response.status}`);
    }
  }
}

export function createStorage(env: WorkerEnv): ObjectStorage {
  // Relative roots resolve against the repository root so the API and the worker
  // always address the same directory regardless of their working directory.
  if (env.STORAGE_DRIVER === 's3') {
    const missing = [
      ['S3_ACCESS_KEY_ID', env.S3_ACCESS_KEY_ID],
      ['S3_SECRET_ACCESS_KEY', env.S3_SECRET_ACCESS_KEY],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`STORAGE_DRIVER=s3 requires ${missing.join(', ')}.`);
    }
    const shared = {
      endpoint: env.S3_ENDPOINT || `https://s3.${env.S3_REGION || 'us-east-1'}.amazonaws.com`,
      region: env.S3_REGION || 'us-east-1',
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    };
    const publicBucket = env.S3_PUBLIC_BUCKET || env.S3_BUCKET;
    const privateBucket = env.S3_PRIVATE_BUCKET || env.S3_BUCKET;
    if (!publicBucket || !privateBucket) {
      throw new Error(
        'STORAGE_DRIVER=s3 requires S3_PUBLIC_BUCKET and S3_PRIVATE_BUCKET (or S3_BUCKET fallback).',
      );
    }
    return new RoutedObjectStorage({
      public: new S3ObjectStorage({ ...shared, bucket: publicBucket }),
      private: new S3ObjectStorage({ ...shared, bucket: privateBucket }),
    });
  }
  const local = new LocalObjectStorage(resolveFromRepoRoot(env.STORAGE_LOCAL_ROOT));
  return new RoutedObjectStorage({ public: local, private: local });
}

function findRepoRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return start;
}

function resolveFromRepoRoot(value: string): string {
  if (isAbsolute(value)) return value;
  return resolve(findRepoRoot(__dirname), value);
}
