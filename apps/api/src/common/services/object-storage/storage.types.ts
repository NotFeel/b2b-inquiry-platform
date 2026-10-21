import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  sizeBytes: number;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  createReadStream(key: string): Readable;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export interface S3DriverOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}
