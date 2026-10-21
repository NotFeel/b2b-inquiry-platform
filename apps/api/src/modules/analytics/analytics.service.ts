import { Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@b2b/contracts';
import type {
  AnalyticsCountryRow,
  AnalyticsOverview,
  AnalyticsRealtime,
  AnalyticsTimeseriesPoint,
} from '@b2b/contracts';
import type { AnalyticsEventInput, AnalyticsRangeQuery } from '@b2b/validation';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { CryptoService } from '../../common/services/crypto.service';
import { GeoService } from '../../common/services/geo.service';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface AnalyticsContext {
  ip: string | null;
  sessionHash: string;
  referrerHost?: string | null;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly rateLimit: RateLimitService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Stores one storefront event.
   *
   * The raw IP is used only to derive a country code and is then discarded; the
   * session identifier is stored as a keyed hash (docs/09 §4, docs/13 §3).
   */
  async ingest(input: AnalyticsEventInput, context: AnalyticsContext): Promise<{ accepted: true }> {
    const rate = await this.rateLimit.consume(
      `analytics:${context.sessionHash}`,
      this.env.ANALYTICS_EVENTS_PER_MINUTE,
      60,
    );
    if (!rate.allowed) {
      throw new ApiError(ERROR_CODES.rateLimited, 'Too many analytics events.');
    }

    const countryCode = this.geo.lookupCountry(context.ip);
    const now = new Date();

    const session = await this.prisma.visitorSession.upsert({
      where: { sessionHash: context.sessionHash },
      create: {
        sessionHash: context.sessionHash,
        countryCode,
        firstSeenAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + this.env.ANALYTICS_RAW_RETENTION_DAYS * 86_400_000),
      },
      update: {
        lastSeenAt: now,
        ...(countryCode ? { countryCode } : {}),
      },
    });

    if (input.eventName === 'page_view') {
      await this.prisma.pageView.create({
        data: {
          visitorSessionId: session.id,
          path: input.path?.slice(0, 1000) ?? '/',
          referrerHost: input.referrerHost ?? context.referrerHost ?? null,
          countryCode,
          occurredAt: now,
        },
      });
    }

    await this.prisma.analyticsEvent.create({
      data: {
        visitorSessionId: session.id,
        eventName: input.eventName,
        path: input.path?.slice(0, 1000) ?? null,
        countryCode,
        // Whitelisted context only; the schema rejects other shapes.
        metadata: (input.context ?? undefined) as never,
        occurredAt: now,
      },
    });

    return { accepted: true };
  }

  resolveSessionHash(sessionId: string): string {
    return this.crypto.anonymize(`analytics:${sessionId}`);
  }

  private resolveRange(query: AnalyticsRangeQuery): { start: Date; end: Date } {
    const end = query.to ? new Date(query.to) : new Date();
    if (query.range === 'realtime') {
      return { start: new Date(end.getTime() - this.env.ANALYTICS_ACTIVE_WINDOW_SECONDS * 1000), end };
    }
    if (query.range === 'today') {
      const start = new Date(end);
      start.setUTCHours(0, 0, 0, 0);
      return { start, end };
    }
    if (query.range === '7d') return { start: new Date(end.getTime() - 7 * 86_400_000), end };
    if (query.range === '30d') return { start: new Date(end.getTime() - 30 * 86_400_000), end };
    return { start: query.from ? new Date(query.from) : new Date(end.getTime() - 86_400_000), end };
  }

  async overview(query: AnalyticsRangeQuery): Promise<AnalyticsOverview> {
    const { start, end } = this.resolveRange(query);
    const windowStart = new Date(Date.now() - this.env.ANALYTICS_ACTIVE_WINDOW_SECONDS * 1000);
    const [pageViews, uniqueVisitors, activeSessions, whatsappClicks, productSelects, unknownCountry, lastEvent] =
      await this.prisma.$transaction([
        this.prisma.pageView.count({ where: { occurredAt: { gte: start, lte: end } } }),
        this.prisma.visitorSession.count({ where: { lastSeenAt: { gte: start, lte: end } } }),
        this.prisma.visitorSession.count({ where: { lastSeenAt: { gte: windowStart } } }),
        this.prisma.analyticsEvent.count({
          where: { eventName: 'whatsapp_click', occurredAt: { gte: start, lte: end } },
        }),
        this.prisma.analyticsEvent.count({
          where: { eventName: 'product_select', occurredAt: { gte: start, lte: end } },
        }),
        this.prisma.pageView.count({
          where: { occurredAt: { gte: start, lte: end }, countryCode: null },
        }),
        this.prisma.analyticsEvent.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
      ]);

    return {
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      timezone: query.timezone,
      pageViews,
      uniqueVisitors,
      activeSessions,
      whatsappClicks,
      productSelects,
      unknownCountryPageViews: unknownCountry,
      lastEventAt: lastEvent?.occurredAt.toISOString() ?? null,
    };
  }

  async timeseries(query: AnalyticsRangeQuery): Promise<AnalyticsTimeseriesPoint[]> {
    const { start, end } = this.resolveRange(query);
    const bucket = query.granularity === 'hour' ? 'hour' : 'day';
    const rows = await this.prisma.$queryRaw<{ bucket: Date; page_views: bigint; sessions: bigint }[]>`
      SELECT date_trunc(${bucket}, pv."occurredAt") AS bucket,
             COUNT(*)::bigint AS page_views,
             COUNT(DISTINCT pv."visitorSessionId")::bigint AS sessions
      FROM page_views pv
      WHERE pv."occurredAt" >= ${start} AND pv."occurredAt" <= ${end}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      bucket: row.bucket.toISOString(),
      pageViews: Number(row.page_views),
      uniqueVisitors: Number(row.sessions),
    }));
  }

  async countries(query: AnalyticsRangeQuery): Promise<AnalyticsCountryRow[]> {
    const { start, end } = this.resolveRange(query);
    const rows = await this.prisma.$queryRaw<
      { country_code: string | null; page_views: bigint; sessions: bigint }[]
    >`
      SELECT pv."countryCode" AS country_code,
             COUNT(*)::bigint AS page_views,
             COUNT(DISTINCT pv."visitorSessionId")::bigint AS sessions
      FROM page_views pv
      WHERE pv."occurredAt" >= ${start} AND pv."occurredAt" <= ${end}
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 200
    `;
    const windowStart = new Date(Date.now() - this.env.ANALYTICS_ACTIVE_WINDOW_SECONDS * 1000);
    const activeRows = await this.prisma.$queryRaw<{ country_code: string | null; active: bigint }[]>`
      SELECT "countryCode" AS country_code, COUNT(*)::bigint AS active
      FROM visitor_sessions
      WHERE "lastSeenAt" >= ${windowStart}
      GROUP BY 1
    `;
    const activeByCountry = new Map(
      activeRows.map((row) => [row.country_code ?? 'UNKNOWN', Number(row.active)]),
    );
    return rows.map((row) => ({
      countryCode: row.country_code,
      pageViews: Number(row.page_views),
      uniqueVisitors: Number(row.sessions),
      activeSessions: activeByCountry.get(row.country_code ?? 'UNKNOWN') ?? 0,
    }));
  }

  async realtime(): Promise<AnalyticsRealtime> {
    const windowSeconds = this.env.ANALYTICS_ACTIVE_WINDOW_SECONDS;
    const windowStart = new Date(Date.now() - windowSeconds * 1000);
    const [activeSessions, byCountry, lastEvent] = await this.prisma.$transaction([
      this.prisma.visitorSession.count({ where: { lastSeenAt: { gte: windowStart } } }),
      this.prisma.$queryRaw<{ country_code: string | null; active: bigint; views: bigint }[]>`
        SELECT vs."countryCode" AS country_code,
               COUNT(*)::bigint AS active,
               COALESCE(SUM((SELECT COUNT(*) FROM page_views pv WHERE pv."visitorSessionId" = vs.id)), 0)::bigint AS views
        FROM visitor_sessions vs
        WHERE vs."lastSeenAt" >= ${windowStart}
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 50
      `,
      this.prisma.analyticsEvent.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
    ]);

    return {
      windowSeconds,
      activeSessions,
      activeCountries: byCountry.map((row) => ({
        countryCode: row.country_code,
        pageViews: Number(row.views),
        uniqueVisitors: Number(row.active),
        activeSessions: Number(row.active),
      })),
      lastEventAt: lastEvent?.occurredAt.toISOString() ?? null,
      generatedAt: new Date().toISOString(),
    };
  }
}
