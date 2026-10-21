'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StatCard } from '@b2b/ui';
import type { AnalyticsRealtime } from '@b2b/contracts';
import { adminApi } from '../../../../lib/admin-api';
import { localeHref } from '../../../../lib/i18n';
import { useSession } from '../../../../components/session-provider';

interface Overview {
  activeSessions: number;
  pageViews: number;
  uniqueVisitors: number;
  whatsappClicks: number;
  unknownCountryPageViews: number;
  lastEventAt: string | null;
}

interface Totals {
  products: number;
  customers: number;
  activities: number;
  exports: number;
}

export default function DashboardPage() {
  const { t, locale, can } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [realtime, setRealtime] = useState<AnalyticsRealtime | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [analytics, rt, products, customers, activities, exports] = await Promise.all([
          can('analytics.read')
            ? adminApi.get<{ data: Overview }>('/admin/analytics/overview', { range: 'today' })
            : Promise.resolve(null),
          can('analytics.read')
            ? adminApi.get<{ data: AnalyticsRealtime }>('/admin/analytics/realtime')
            : Promise.resolve(null),
          can('product.read') ? adminApi.list<unknown>('/admin/products', { pageSize: 1 }) : Promise.resolve(null),
          can('customer.read') ? adminApi.list<unknown>('/admin/customers', { pageSize: 1 }) : Promise.resolve(null),
          can('lead.read')
            ? adminApi.list<unknown>('/admin/inquiry-activities', { pageSize: 1 })
            : Promise.resolve(null),
          can('quote.read') ? adminApi.list<unknown>('/admin/quote-exports', { pageSize: 1 }) : Promise.resolve(null),
        ]);
        if (analytics) setOverview(analytics.data);
        if (rt) setRealtime(rt.data);
        setTotals({
          products: products?.pagination.total ?? 0,
          customers: customers?.pagination.total ?? 0,
          activities: activities?.pagination.total ?? 0,
          exports: exports?.pagination.total ?? 0,
        });
      } catch {
        setError(t('common.error'));
      }
    };
    void load();
    // Realtime values refresh every 30 seconds (docs/09 §5).
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [can, t]);

  return (
    <div className="stack">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">{t('dashboard.title')}</h1>
          {error ? <p className="field-error">{error}</p> : null}
        </div>
      </header>

      <div className="stat-grid">
        <StatCard label={t('dashboard.catalog')} value={String(totals?.products ?? 0)} />
        <StatCard label={t('dashboard.customers')} value={String(totals?.customers ?? 0)} />
        <StatCard label={t('dashboard.inquiries')} value={String(totals?.activities ?? 0)} />
        <StatCard label={t('dashboard.exports')} value={String(totals?.exports ?? 0)} />
      </div>

      {can('analytics.read') ? (
        <>
          <div className="stat-grid">
            <StatCard
              label={t('analytics.active')}
              value={String(realtime?.activeSessions ?? overview?.activeSessions ?? 0)}
              hint={`${realtime?.windowSeconds ?? 300}s`}
            />
            <StatCard label={t('analytics.pv')} value={String(overview?.pageViews ?? 0)} />
            <StatCard label={t('analytics.uv')} value={String(overview?.uniqueVisitors ?? 0)} />
            <StatCard label={t('analytics.whatsappClicks')} value={String(overview?.whatsappClicks ?? 0)} />
          </div>
          <p className="field-help">
            {t('analytics.lastUpdated')}:{' '}
            {realtime?.lastEventAt ? new Date(realtime.lastEventAt).toLocaleString(locale) : '-'} ·{' '}
            {t('analytics.latencyNote')}
          </p>
        </>
      ) : null}

      <section className="panel">
        <h2 style={{ fontSize: 'var(--text-base)' }}>{t('dashboard.quickLinks')}</h2>
        <div className="deep-link-grid">
          <Link className="btn btn-secondary btn-sm" href={localeHref(locale, '/products')}>
            {t('nav.products')}
          </Link>
          <Link className="btn btn-secondary btn-sm" href={localeHref(locale, '/categories')}>
            {t('nav.categories')}
          </Link>
          <Link className="btn btn-secondary btn-sm" href={localeHref(locale, '/leads')}>
            {t('nav.leads')}
          </Link>
          <Link className="btn btn-secondary btn-sm" href={localeHref(locale, '/quote-exports')}>
            {t('nav.quotes')}
          </Link>
          <Link className="btn btn-secondary btn-sm" href={localeHref(locale, '/pi-documents')}>
            {t('nav.pi')}
          </Link>
        </div>
      </section>
    </div>
  );
}
