import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Where encrypted document blobs live. The API encrypts before calling `put` (docs/DECISIONS.md D-005),
 * so implementations only ever see ciphertext.
 */
export interface StorageAdapter {
  readonly name: string;
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

/** Local folder (development without Docker, and tests). */
export class FsStorageAdapter implements StorageAdapter {
  readonly name = 'fs';

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root))) throw new Error('invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }

  get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}

/** Any S3-compatible store (RustFS in docker compose, AWS S3, a self-built MinIO…). */
export class S3StorageAdapter implements StorageAdapter {
  readonly name = 's3';
  private bucketReady: Promise<void> | null = null;

  constructor(
    private readonly opts: {
      endpoint?: string;
      region: string;
      bucket: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      forcePathStyle: boolean;
    },
  ) {}

  private async client() {
    const s3 = await import('@aws-sdk/client-s3');
    const client = new s3.S3Client({
      endpoint: this.opts.endpoint,
      region: this.opts.region,
      forcePathStyle: this.opts.forcePathStyle,
      credentials:
        this.opts.accessKeyId && this.opts.secretAccessKey
          ? { accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey }
          : undefined,
    });
    this.bucketReady ??= client
      .send(new s3.HeadBucketCommand({ Bucket: this.opts.bucket }))
      .then(() => undefined)
      .catch(async () => {
        await client.send(new s3.CreateBucketCommand({ Bucket: this.opts.bucket }));
      });
    await this.bucketReady;
    return { s3, client };
  }

  async put(key: string, body: Buffer): Promise<void> {
    const { s3, client } = await this.client();
    await client.send(
      new s3.PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/octet-stream',
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const { s3, client } = await this.client();
    const res = await client.send(new s3.GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    const { s3, client } = await this.client();
    await client.send(new s3.DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }
}
