import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Load the repository `.env` before anything reads process.env (the Nest
// container validates the environment on bootstrap).
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

import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';
import { APP_ENV, type AppEnv } from './config/config.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { JsonLogger } from './common/logger.service';
import { syncReferenceDataAtStartup } from './reference-data-startup';

async function bootstrap(): Promise<void> {
  // Keep authorization and navigation reference data versioned together with
  // the API. This runs in every environment before the HTTP port opens and is
  // idempotent/serialized by the database synchronizer.
  await syncReferenceDataAtStartup();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<AppEnv>(APP_ENV);
  const logger = new JsonLogger(env);
  app.useLogger(logger);

  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');

  // Credentialed requests are limited to the configured admin origins; the
  // storefront origin is allowed for public analytics/telemetry calls.
  const allowedOrigins = new Set([env.ADMIN_BASE_URL, env.APP_BASE_URL, ...env.adminAllowedOrigins]);
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-request-id', 'idempotency-key', 'x-csrf-token'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });

  // Request bodies stay small: files use multipart uploads with their own limit.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  app.useGlobalInterceptors(new RequestContextInterceptor(logger));
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.enableShutdownHooks();

  if (env.TRUST_PROXY) {
    const instance = app.getHttpAdapter().getInstance() as express.Express;
    instance.set('trust proxy', 1);
  }

  await app.listen(env.API_PORT);
  logger.info('api.started', { port: env.API_PORT, env: env.NODE_ENV });
}

void bootstrap();
