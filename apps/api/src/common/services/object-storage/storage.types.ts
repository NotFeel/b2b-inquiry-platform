import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  sizeBytes: number;
}

export interface StoredObjectMetadata {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  createReadStream(key: string): Readable;
  exists(key: string): Promise<boolean>;
  stat(key: string): Promise<StoredObjectMetadata | null>;
  delete(key: string): Promise<void>;
  presignPut(key: string, contentType: string, expiresSeconds: number): Promise<string>;
  presignGet(key: string, expiresSeconds: number): Promise<string>;
}

export interface S3DriverOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}
