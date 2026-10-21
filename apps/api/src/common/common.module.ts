import { Global, Module } from '@nestjs/common';
import { JsonLogger } from './logger.service';
import { AuditService } from './services/audit.service';
import { CryptoService } from './services/crypto.service';
import { GeoService } from './services/geo.service';
import { JobsService } from './services/jobs.service';
import { RateLimitService } from './services/rate-limit.service';
import { RedisService } from './services/redis.service';
import { SanitizeService } from './services/sanitize.service';
import { StorageService } from './services/storage.service';

@Global()
@Module({
  providers: [
    JsonLogger,
    AuditService,
    CryptoService,
    GeoService,
    JobsService,
    RateLimitService,
    RedisService,
    SanitizeService,
    StorageService,
  ],
  exports: [
    JsonLogger,
    AuditService,
    CryptoService,
    GeoService,
    JobsService,
    RateLimitService,
    RedisService,
    SanitizeService,
    StorageService,
  ],
})
export class CommonModule {}
