import { z } from 'zod';

// The API refuses to boot on an invalid environment. Nothing here has a
// production-safe default for secrets: SESSION_SECRET must be provided.
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
    APP_BASE_URL: z.string().trim().default('http://localhost:3000'),
    /**
     * Shared secret for the storefront on-demand revalidation webhook
     * (docs/21 §7.9). When unset, public config falls back to its ISR TTL.
     */
    REVALIDATE_SECRET: z.string().trim().min(8).optional(),
    ADMIN_BASE_URL: z.string().trim().default('http://localhost:3001'),
    API_BASE_URL: z.string().trim().default('http://localhost:3002'),
    ADMIN_ALLOWED_ORIGINS: z.string().trim().default('http://localhost:3001'),

    DATABASE_URL: z.string().trim().min(1),
    REDIS_URL: z.string().trim().default(''),

    SESSION_SECRET: z.string().min(24, 'SESSION_SECRET must be at least 24 characters.'),
    SESSION_COOKIE_NAME: z.string().trim().default('b2b_admin_session'),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(50).default(8),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_ROOT: z.string().trim().default('./.data/uploads'),
    S3_ENDPOINT: z.string().trim().default(''),
    S3_REGION: z.string().trim().default(''),
    S3_BUCKET: z.string().trim().default(''),
    S3_ACCESS_KEY_ID: z.string().trim().default(''),
    S3_SECRET_ACCESS_KEY: z.string().trim().default(''),
    S3_PUBLIC_BASE_URL: z.string().trim().default(''),
    S3_FORCE_PATH_STYLE: booleanish.default(true),

    WHATSAPP_BUSINESS_NUMBER: z.string().trim().default(''),
    WHATSAPP_MAX_SELECTED_SKUS: z.coerce.number().int().min(1).max(100).default(20),

    GEOIP_PROVIDER: z.enum(['database', 'none']).default('database'),
    GEOIP_DATABASE_PATH: z.string().trim().default('./.data/geoip/GeoLite2-Country.mmdb'),
    ANALYTICS_SALT: z.string().trim().default(''),
    ANALYTICS_ACTIVE_WINDOW_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
    ANALYTICS_RAW_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
    ANALYTICS_EVENTS_PER_MINUTE: z.coerce.number().int().min(10).max(6000).default(120),

    UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(104_857_600).default(10_485_760),
    UPLOAD_MAX_PIXELS: z.coerce.number().int().min(1_000_000).max(500_000_000).default(50_000_000),
    IMAGE_DERIVATIVE_WIDTHS: z.string().trim().default('320,640,1280'),

    QUEUE_PREFIX: z.string().trim().default('b2b'),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
    JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
    JOB_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

    SITE_TIMEZONE: z.string().trim().default('UTC'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    LOG_PRETTY: booleanish.default(false),
    TRUST_PROXY: booleanish.default(true),
  })
  .transform((value) => ({
    ...value,
    adminAllowedOrigins: value.ADMIN_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    imageDerivativeWidths: value.IMAGE_DERIVATIVE_WIDTHS.split(',')
      .map((width) => Number.parseInt(width.trim(), 10))
      .filter((width) => Number.isFinite(width) && width > 0),
    analyticsSalt: value.ANALYTICS_SALT.length > 0 ? value.ANALYTICS_SALT : value.SESSION_SECRET,
  }));

export type AppEnv = z.infer<typeof envSchema>;
