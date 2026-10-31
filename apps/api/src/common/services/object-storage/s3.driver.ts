import { createHash, createHmac } from 'node:crypto';
import type { Readable } from 'node:stream';
import { PassThrough, Readable as NodeReadable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  S3DriverOptions,
  StorageDriver,
  StoredObject,
  StoredObjectMetadata,
} from './storage.types';

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function amzDate(date: Date): { timestamp: string; shortDate: string } {
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { timestamp, shortDate: timestamp.slice(0, 8) };
}

/**
 * AWS Signature Version 4 key derivation.
 *
 * The signing key must be derived in four chained HMAC steps:
 * date -> region -> service -> aws4_request. Reusing the secret or skipping
 * any step produces syntactically valid but unusable signatures (R2 returns 403).
 */
function deriveSigningKey(secretAccessKey: string, shortDate: string, region: string): Buffer {
  const dateKey = createHmac('sha256', `AWS4${secretAccessKey}`).update(shortDate).digest();
  const regionKey = createHmac('sha256', dateKey).update(region).digest();
  const serviceKey = createHmac('sha256', regionKey).update('s3').digest();
  return createHmac('sha256', serviceKey).update('aws4_request').digest();
}

// Minimal SigV4 implementation for S3-compatible object storage. Keeping it
// dependency-free avoids pulling a large SDK into the API image; the surface is
// limited to the four operations this platform needs.
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';

  constructor(private readonly options: S3DriverOptions) {}

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
    const signingKey = deriveSigningKey(
      this.options.secretAccessKey,
      shortDate,
      this.options.region,
    );
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

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const response = await this.request('PUT', key, body, contentType);
    if (!response.ok) {
      throw new Error(`storage.s3_put_failed:${response.status}`);
    }
    return { key, sizeBytes: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.request('GET', key);
    if (!response.ok) throw new Error(`storage.s3_get_failed:${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  createReadStream(key: string): Readable {
    // Pipe the fetch body through a real stream pipeline. This preserves
    // backpressure for large generated PDFs instead of buffering the object in
    // the API process before sending it to the browser.
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

  async stat(key: string): Promise<StoredObjectMetadata | null> {
    const response = await this.request('HEAD', key);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`storage.s3_head_failed:${response.status}`);
    }
    return {
      sizeBytes: Number.parseInt(response.headers.get('content-length') ?? '0', 10),
      contentType: response.headers.get('content-type'),
      etag: response.headers.get('etag'),
    };
  }

  async delete(key: string): Promise<void> {
    const response = await this.request('DELETE', key);
    if (!response.ok && response.status !== 404) {
      throw new Error(`storage.s3_delete_failed:${response.status}`);
    }
  }

  async presignPut(key: string, _contentType: string, expiresSeconds: number): Promise<string> {
    return this.presign('PUT', key, expiresSeconds);
  }

  async presignGet(key: string, expiresSeconds: number): Promise<string> {
    return this.presign('GET', key, expiresSeconds);
  }

  private presign(method: 'PUT' | 'GET', key: string, expiresSeconds: number): string {
    const url = this.objectUrl(key);
    const { timestamp, shortDate } = amzDate(new Date());
    const scope = `${shortDate}/${this.options.region}/s3/aws4_request`;
    const credential = `${this.options.accessKeyId}/${scope}`;
    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set('X-Amz-Credential', credential);
    url.searchParams.set('X-Amz-Date', timestamp);
    url.searchParams.set('X-Amz-Expires', String(expiresSeconds));
    url.searchParams.set('X-Amz-SignedHeaders', 'host');
    url.searchParams.set('X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD');

    const canonicalQuery = [...url.searchParams.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      .join('&');
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery,
      `host:${url.host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256Hex(canonicalRequest)].join(
      '\n',
    );
    const signingKey = deriveSigningKey(
      this.options.secretAccessKey,
      shortDate,
      this.options.region,
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    url.searchParams.set('X-Amz-Signature', signature);
    return url.toString();
  }
}
