import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { analyticsEventSchema, findPiiFields } from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { ClientIp, Public } from '../../common/decorators';
import { AnalyticsService } from './analytics.service';

@Controller('public/analytics')
export class PublicAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Anonymous storefront telemetry.
   *
   * The payload is inspected for personal data before schema validation, so a
   * caller cannot smuggle phone numbers or email addresses into the analytics
   * tables (docs/09 §4).
   */
  @Public()
  @Post('events')
  @HttpCode(202)
  async ingest(
    @Body() rawBody: unknown,
    @ClientIp() ip: string | null,
    @Headers('referer') referrer?: string,
  ) {
    const pii = findPiiFields(rawBody);
    if (pii.length > 0) {
      throw ApiError.validation('Analytics payloads must not contain personal data.', {
        rejectedFields: pii.join(','),
      });
    }
    const parsed = analyticsEventSchema.safeParse(rawBody);
    if (!parsed.success) {
      const details: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        details[issue.path.join('.') || '(root)'] = issue.message;
      }
      throw ApiError.validation('Analytics event failed validation.', details);
    }

    let referrerHost: string | null = null;
    if (referrer) {
      try {
        referrerHost = new URL(referrer).host.slice(0, 255);
      } catch {
        referrerHost = null;
      }
    }

    return this.analytics.ingest(parsed.data, {
      ip,
      sessionHash: this.analytics.resolveSessionHash(parsed.data.sessionId),
      referrerHost,
    });
  }
}
