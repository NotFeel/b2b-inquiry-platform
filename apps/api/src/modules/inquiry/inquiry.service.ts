import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_WHATSAPP_SELECTION_LIMIT, ERROR_CODES, buildInquiryMessage } from '@b2b/contracts';
import type { PublicInquiryIntentResult } from '@b2b/contracts';
import type { InquiryIntentInput } from '@b2b/validation';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { CryptoService } from '../../common/services/crypto.service';
import { GeoService } from '../../common/services/geo.service';
import { JsonLogger } from '../../common/logger.service';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PublicCatalogService } from '../products/public-catalog.service';

@Injectable()
export class InquiryService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly catalog: PublicCatalogService,
    private readonly settings: SettingsService,
    private readonly rateLimit: RateLimitService,
    private readonly geo: GeoService,
    private readonly crypto: CryptoService,
    private readonly logger: JsonLogger,
  ) {}

  /**
   * Records that a visitor opened WhatsApp with a set of SKUs.
   *
   * This endpoint deliberately does not claim a message was sent: `wa.me` links
   * cannot report delivery (docs/09 §1). SKUs are validated against the public
   * catalogue so drafts and discontinued products cannot be probed.
   */
  async createIntent(
    input: InquiryIntentInput,
    context: { ip: string | null; sessionHash: string | null },
  ): Promise<PublicInquiryIntentResult> {
    const limit = await this.settings.getBatchInquiryLimit();
    const uniqueSkus = Array.from(new Set(input.skus.map((sku) => sku.trim()).filter(Boolean)));

    if (uniqueSkus.length > limit) {
      // Never silently drop SKUs: the storefront must ask the visitor to split
      // the selection (docs/01 §5).
      throw new ApiError(
        ERROR_CODES.validationFailed,
        `A maximum of ${limit} products can be sent in one WhatsApp message.`,
        { details: { limit, selected: uniqueSkus.length } },
      );
    }

    const rateKey = `inquiry:${context.sessionHash ?? context.ip ?? 'anonymous'}`;
    const rate = await this.rateLimit.consume(rateKey, 20, 60);
    if (!rate.allowed) {
      throw new ApiError(ERROR_CODES.rateLimited, 'Too many inquiry requests. Please retry shortly.');
    }

    const available = await this.catalog.findPublicSkus(uniqueSkus);
    const availableSkus = new Set(available.map((product) => product.sku));
    const accepted = uniqueSkus.filter((sku) => availableSkus.has(sku));
    const rejected = uniqueSkus.filter((sku) => !availableSkus.has(sku));
    if (rejected.length > 0) {
      this.logger.warn(
        'inquiry.unknown_skus',
        { count: rejected.length },
        'InquiryService',
      );
    }
    if (accepted.length === 0) {
      throw new ApiError(ERROR_CODES.validationFailed, 'None of the selected products are available.');
    }

    const whatsappNumber = await this.settings.getWhatsAppNumber();
    // Names are resolved server-side from the public projection so the sales
    // team can read the list and the client cannot inject arbitrary text.
    const nameBySku = new Map(
      available.map((product) => [
        product.sku,
        product.translations.find((translation) => translation.locale === 'en-US')?.name ??
          product.translations[0]?.name ??
          null,
      ]),
    );
    const productBySku = new Map(available.map((product) => [product.sku, product]));
    const appBase = this.env.APP_BASE_URL.replace(/\/+$/, '');
    const sourceUrl =
      input.sourceUrl ??
      (input.sourcePath
        ? `${appBase}/${input.locale}${input.sourcePath.startsWith('/') ? input.sourcePath : `/${input.sourcePath}`}`
        : null);
    const message = buildInquiryMessage({
      items: accepted.map((sku) => {
        const product = productBySku.get(sku);
        return {
          sku,
          name: nameBySku.get(sku) ?? null,
          quantity: input.quantities?.[sku] ?? null,
          url: product ? `${appBase}/${input.locale}/products/${product.slug}` : null,
        };
      }),
      sourceUrl,
      limit: limit || DEFAULT_WHATSAPP_SELECTION_LIMIT,
      locale: input.locale,
    });
    if (message.truncated) {
      throw new ApiError(ERROR_CODES.validationFailed, 'The selection exceeds the batch inquiry limit.');
    }

    const countryCode = this.geo.lookupCountry(context.ip);
    const intent = await this.prisma.inquiryIntent.create({
      data: {
        skus: accepted,
        skuCount: accepted.length,
        sourcePath: input.sourcePath?.slice(0, 1000) ?? null,
        locale: input.locale,
        sessionHash: context.sessionHash,
        countryCode,
      },
    });

    return {
      intentId: intent.id,
      skus: accepted,
      prefilledMessage: message.message,
      whatsappNumber,
    };
  }

  hashSession(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null;
    return this.crypto.anonymize(`session:${sessionId}`);
  }
}
