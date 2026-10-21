import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/config.module';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Sensitive keys are dropped before anything reaches stdout. Logs must never
// contain passwords, tokens, cookies, full phone numbers or raw IPs (docs/07 §8).
const REDACTED_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'token',
  'cookie',
  'authorization',
  'sessionid',
  'ip',
  'ipaddress',
  'rawip',
  'phone',
  'phonee164',
  'salespersonphone',
  'whatsappnumber',
]);

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = REDACTED_KEYS.has(key.replace(/[_-]/g, '').toLowerCase())
      ? '[redacted]'
      : redact(child, depth + 1);
  }
  return result;
}

@Injectable()
export class JsonLogger implements LoggerService {
  private readonly threshold: number;
  private readonly service = 'api';

  // Only the environment is injected; Nest would otherwise try to resolve the
  // optional second constructor argument as a provider.
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    this.threshold = LEVEL_WEIGHT[env.LOG_LEVEL];
  }

  private write(level: LogLevel, message: unknown, context?: string, meta?: Record<string, unknown>) {
    if (LEVEL_WEIGHT[level] < this.threshold) return;
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      environment: this.env.NODE_ENV,
      context: context ?? undefined,
      message: typeof message === 'string' ? message : redact(message),
      ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
    };
    const line = this.env.LOG_PRETTY
      ? `[${level}] ${context ?? this.service}: ${payload.message as string} ${JSON.stringify(redact(meta ?? {}))}`
      : JSON.stringify(payload);
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  log(message: unknown, context?: string) {
    this.write('info', message, context);
  }

  info(message: unknown, meta?: Record<string, unknown>, context?: string) {
    this.write('info', message, context, meta);
  }

  debug(message: unknown, meta?: Record<string, unknown>, context?: string) {
    this.write('debug', message, context, meta);
  }

  warn(message: unknown, meta?: Record<string, unknown>, context?: string) {
    this.write('warn', message, context, meta);
  }

  error(message: unknown, trace?: string, context?: string, meta?: Record<string, unknown>) {
    this.write('error', message, context, { ...meta, trace: trace ? redact(trace) : undefined });
  }

  verbose(message: unknown, context?: string) {
    this.write('debug', message, context);
  }
}
