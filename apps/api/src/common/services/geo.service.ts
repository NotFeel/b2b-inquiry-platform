import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { JsonLogger } from '../logger.service';

import type { CityResponse, Reader } from 'maxmind';

// GeoIP only ever yields a country code; the raw IP is discarded after lookup
// (docs/09 §5, docs/13 §3). `unknown` stays a legitimate outcome.
@Injectable()
export class GeoService implements OnModuleInit {
  private reader: Reader<CityResponse> | null = null;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly logger: JsonLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.GEOIP_PROVIDER !== 'database') return;
    if (!existsSync(this.env.GEOIP_DATABASE_PATH)) {
      this.logger.warn(
        'geoip.database_missing',
        { path: this.env.GEOIP_DATABASE_PATH },
        'GeoService',
      );
      return;
    }
    try {
      const maxmind = await import('maxmind');
      this.reader = await maxmind.open<CityResponse>(this.env.GEOIP_DATABASE_PATH);
    } catch (error) {
      this.logger.error(
        'geoip.init_failed',
        error instanceof Error ? error.message : String(error),
        'GeoService',
      );
      this.reader = null;
    }
  }

  lookupCountry(ip: string | null | undefined): string | null {
    if (!this.reader || !ip) return null;
    try {
      const result = this.reader.get(ip);
      const code = result?.country?.iso_code;
      return typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? code : null;
    } catch {
      return null;
    }
  }

  isEnabled(): boolean {
    return this.reader !== null;
  }
}
