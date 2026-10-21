import { Global, Module } from '@nestjs/common';
import { envSchema, type AppEnv } from './env';

export const APP_ENV = 'APP_ENV';

// Re-exported so modules can import the validated environment shape without
// reaching into the schema file.
export type { AppEnv } from './env';

// Loads .env once (see main.ts) and validates it before any provider is built.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n  - ');
    throw new Error(`Invalid environment configuration:\n  - ${issues}`);
  }
  return parsed.data;
}

@Global()
@Module({
  providers: [
    {
      provide: APP_ENV,
      useFactory: (): AppEnv => loadEnv(),
    },
  ],
  exports: [APP_ENV],
})
export class ConfigModule {}
