import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

for (const candidate of [
  process.env.ENV_FILE,
  join(process.cwd(), '.env'),
  resolve(process.cwd(), '..', '..', '.env'),
]) {
  if (candidate && existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
  JOB_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TASK_RUNNER_ID: z.string().trim().default(`${hostname()}:${process.pid}`),
  TASK_LEASE_SECONDS: z.coerce.number().int().min(15).max(3600).default(120),
  TASK_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  TASK_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(250).max(300_000).default(3_000),
  ANALYTICS_RAW_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./.data/uploads'),
  WORKER_TMP_DIR: z.string().default('./.data/tmp'),
  /** Storefront origin, pinged after a physical delete removes an object. */
  APP_BASE_URL: z.string().default('http://localhost:3000'),
  API_BASE_URL: z.string().default('http://localhost:3002'),
  /** Shared secret for the storefront revalidation webhook (docs/24 §9). */
  REVALIDATE_SECRET: z.string().default(''),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_PUBLIC_BUCKET: z.string().default(''),
  S3_PRIVATE_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_PUBLIC_BASE_URL: z.string().default(''),
  S3_FORCE_PATH_STYLE: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    // Must be optional-with-default: the variable is normally absent for the
    // local driver, and a union without a default fails validation outright.
    .default(true)
    .transform((value) => value === true || value === 'true'),
  IMAGE_DERIVATIVE_WIDTHS: z.string().default('320,640,1280'),
  UPLOAD_MAX_PIXELS: z.coerce.number().int().min(1_000_000).max(500_000_000).default(50_000_000),
  IMAGE_PROCESSING_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(20),
  IMAGE_PROCESSING_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  IMAGE_WEBP_QUALITY: z.coerce.number().int().min(40).max(100).default(82),
  QUOTE_EXPORT_MAX_PRODUCTS: z.coerce.number().int().min(1).max(100_000).default(5_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type WorkerEnv = z.infer<typeof schema> & { imageWidths: number[] };

export function loadWorkerEnv(): WorkerEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid worker environment: ${issues}`);
  }
  const imageWidths = parsed.data.IMAGE_DERIVATIVE_WIDTHS.split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 4096)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left - right);
  return {
    ...parsed.data,
    imageWidths: imageWidths.length > 0 ? imageWidths : [320, 640, 1280],
  };
}
