import { Global, Module } from '@nestjs/common';
import { JsonLogger } from './logger.service';
import { AuditService } from './services/audit.service';
import { CryptoService } from './services/crypto.service';
import { GeoService } from './services/geo.service';
import { RateLimitService } from './services/rate-limit.service';
import { SanitizeService } from './services/sanitize.service';
import { StorageService } from './services/storage.service';

@Global()
@Module({
  providers: [
    JsonLogger,
    AuditService,
    CryptoService,
    GeoService,
    RateLimitService,
    SanitizeService,
    StorageService,
  ],
  exports: [
    JsonLogger,
    AuditService,
    CryptoService,
    GeoService,
    RateLimitService,
    SanitizeService,
    StorageService,
  ],
})
export class CommonModule {}
