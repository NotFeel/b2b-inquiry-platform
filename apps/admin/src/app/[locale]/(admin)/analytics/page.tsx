'use client';

import { useCallback, useEffect, useState } from 'react';
import { Select, StatCard } from '@b2b/ui';
import type { AnalyticsCountryRow, AnalyticsOverview, AnalyticsRealtime } from '@b2b/contracts';
import { adminApi } from '../../../../lib/admin-api';
import { useSession } from '../../../../components/session-provider';

// Country aggregates are intentionally coarse: GeoIP only resolves a country and
// "unknown" stays a valid bucket (docs/09 §5).
export default function AnalyticsPage() {
  const { t, locale } = useSession();
  const [range, setRange] = useState<'today' | '7d' | '30d'>('today');
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [countries, setCountries] = useState<AnalyticsCountryRow[]>([]);
  const [realtime, setRealtime] = useState<AnalyticsRealtime | null>(null);

  const load = useCallback(async () => {
    const [summary, countryRows, live] = await Promise.all([
      adminApi.get<{ data: AnalyticsOverview }>('/admin/analytics/overview', { range, timezone: 'UTC', granularity: 'day' }),
      adminApi.get<{ data: AnalyticsCountryRow[] }>('/admin/analytics/countries', { range, timezone: 'UTC', granularity: 'day' }),
      adminApi.get<{ data: AnalyticsRealtime }>('/admin/analytics/realtime'),
    ]);
    setOverview(summary.data);
    setCountries(countryRows.data);
    setRealtime(live.data);
  }, [range]);

  useEffect(() => {
    void load().catch(() => undefined);
    const interval = window.setInterval(() => void load().catch(() => undefined), 20_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const maxViews = Math.max(1, ...countries.map((row) => row.pageViews));

  return (
    <div className="stack">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">{t('analytics.title')}</h1>
          <p className="small muted">{t('analytics.latencyNote')}</p>
        </div>
        <Select
          aria-label={t('analytics.range')}
          value={range}
          options={[
            { value: 'today', label: t('analytics.today') },
            { value: '7d', label: t('analytics.sevenDays') },
            { value: '30d', label: t('analytics.thirtyDays') },
          ]}
          onChange={(event) => setRange(event.target.value as 'today' | '7d' | '30d')}
        />
      </header>

      <div className="stat-grid">
        <StatCard label={t('analytics.pv')} value={String(overview?.pageViews ?? 0)} />
        <StatCard label={t('analytics.uv')} value={String(overview?.uniqueVisitors ?? 0)} />
        <StatCard
          label={t('analytics.active')}
          value={String(realtime?.activeSessions ?? overview?.activeSessions ?? 0)}
          hint={`${realtime?.windowSeconds ?? 300}s`}
        />
        <StatCard label={t('analytics.whatsappClicks')} value={String(overview?.whatsappClicks ?? 0)} />
        <StatCard label={t('dashboard.unknownCountry')} value={String(overview?.unknownCountryPageViews ?? 0)} />
      </div>

      <section className="panel">
        <h2 style={{ fontSize: 'var(--text-base)' }}>{t('analytics.countries')}</h2>
        {countries.length === 0 ? (
          <p className="muted small">{t('common.empty')}</p>
        ) : (
          <div className="stack-sm">
            {countries.map((row) => (
              <div className="country-bar" key={row.countryCode ?? 'unknown'}>
                <span className="mono small" style={{ width: 48 }}>
                  {row.countryCode ?? t('analytics.unknown')}
                </span>
                <span className="country-bar-track">
                  <span className="country-bar-fill" style={{ width: `${(row.pageViews / maxViews) * 100}%` }} />
                </span>
                <span className="small muted nowrap">
                  {row.pageViews} PV · {row.activeSessions} active
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="field-help">
          {t('analytics.lastUpdated')}:{' '}
          {realtime?.lastEventAt ? new Date(realtime.lastEventAt).toLocaleString(locale) : '-'}
        </p>
      </section>
    </div>
  );
}
