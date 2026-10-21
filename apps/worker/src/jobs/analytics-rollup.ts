import { PrismaClient } from '@b2b/database';
import type { WorkerLogger } from '../logger';

/**
 * Rolls raw page views into the per-country daily aggregate table and prunes raw
 * events older than the configured retention window (docs/09 §5).
 */
export async function processAnalyticsRollup(
  payload: { retentionDays: number; targetDate?: string },
  deps: { prisma: PrismaClient; logger: WorkerLogger },
): Promise<{ aggregated: number; prunedEvents: number; prunedPageViews: number }> {
  const { prisma, logger } = deps;
  const targetDate = payload.targetDate ? new Date(payload.targetDate) : new Date(Date.now() - 86_400_000);
  targetDate.setUTCHours(0, 0, 0, 0);
  const nextDate = new Date(targetDate.getTime() + 86_400_000);

  const rows = await prisma.$queryRaw<{ country_code: string | null; views: bigint; sessions: bigint }[]>`
    SELECT "countryCode" AS country_code,
           COUNT(*)::bigint AS views,
           COUNT(DISTINCT "visitorSessionId")::bigint AS sessions
    FROM page_views
    WHERE "occurredAt" >= ${targetDate} AND "occurredAt" < ${nextDate}
    GROUP BY 1
  `;

  for (const row of rows) {
    const countryCode = row.country_code ?? 'XX';
    for (const [metricCode, metricValue] of [
      ['page_views', Number(row.views)],
      ['visitors', Number(row.sessions)],
    ] as const) {
      await prisma.countryDailyAggregate.upsert({
        where: {
          eventDate_countryCode_metricCode: { eventDate: targetDate, countryCode, metricCode },
        },
        create: { eventDate: targetDate, countryCode, metricCode, metricValue: BigInt(metricValue) },
        update: { metricValue: BigInt(metricValue) },
      });
    }
  }

  const cutoff = new Date(Date.now() - payload.retentionDays * 86_400_000);
  const prunedPageViews = await prisma.pageView.deleteMany({ where: { occurredAt: { lt: cutoff } } });
  const prunedEvents = await prisma.analyticsEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } });

  logger.info('analytics.rollup_done', {
    targetDate: targetDate.toISOString().slice(0, 10),
    aggregated: rows.length,
    prunedPageViews: prunedPageViews.count,
    prunedEvents: prunedEvents.count,
  });
  return {
    aggregated: rows.length,
    prunedEvents: prunedEvents.count,
    prunedPageViews: prunedPageViews.count,
  };
}
