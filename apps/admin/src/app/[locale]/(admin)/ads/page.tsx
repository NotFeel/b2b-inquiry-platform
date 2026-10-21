'use client';

import { ResourcePage, type FieldConfig } from '../../../../components/resource-page';
import type { AdAdminSummary } from '@b2b/contracts';
import { useSession } from '../../../../components/session-provider';

export default function AdsPage() {
  const { t, can } = useSession();
  const fields: FieldConfig[] = [
    { name: 'code', label: t('ads.code'), type: 'text', required: true },
    {
      name: 'placement',
      label: t('ads.placement'),
      type: 'select',
      required: true,
      options: [
        { value: 'home-hero', label: 'home-hero' },
        { value: 'catalog-top', label: 'catalog-top' },
        { value: 'sidebar', label: 'sidebar' },
      ],
    },
    { name: 'title', label: t('ads.titleField'), type: 'text' },
    { name: 'description', label: t('ads.descriptionField'), type: 'textarea' },
    { name: 'targetUrl', label: t('ads.targetUrl'), type: 'text', help: 'https:// or mailto: only' },
    { name: 'desktopAssetId', label: t('ads.desktopAsset'), type: 'text' },
    { name: 'mobileAssetId', label: t('ads.mobileAsset'), type: 'text' },
    { name: 'activeFrom', label: t('ads.activeFrom'), type: 'text' },
    { name: 'activeTo', label: t('ads.activeTo'), type: 'text' },
    { name: 'sortOrder', label: t('categories.sortOrder'), type: 'number' },
    { name: 'enabled', label: t('common.status'), type: 'checkbox' },
  ];

  return (
    <ResourcePage<AdAdminSummary>
      title={t('nav.ads')}
      listPath="/admin/ads"
      createPath="/admin/ads"
      itemPath={undefined}
      deletePath={(row) => `/admin/ads/${row.id}`}
      canCreate={can('ad.update')}
      canDelete={can('ad.update')}
      rowKey={(row) => row.id}
      fields={fields}
      fromFormValues={(values) => ({
        code: String(values.code ?? '').trim(),
        placement: values.placement,
        targetUrl: String(values.targetUrl ?? '').trim() || null,
        desktopAssetId: String(values.desktopAssetId ?? '').trim() || null,
        mobileAssetId: String(values.mobileAssetId ?? '').trim() || null,
        activeFrom: String(values.activeFrom ?? '').trim() || null,
        activeTo: String(values.activeTo ?? '').trim() || null,
        sortOrder: Number(values.sortOrder ?? 0) || 0,
        enabled: Boolean(values.enabled),
        translations: [
          {
            locale: 'en-US',
            title: String(values.title ?? '').trim() || null,
            description: String(values.description ?? '').trim() || null,
          },
        ],
      })}
      columns={() => [
        { key: 'code', header: 'code', render: (row) => <span className="mono">{row.code}</span> },
        { key: 'placement', header: t('ads.placement'), render: (row) => row.placement },
        { key: 'title', header: t('ads.titleField'), render: (row) => row.translations['en-US']?.title ?? '-' },
        { key: 'window', header: t('ads.window'), render: (row) => `${row.activeFrom ?? '-'} → ${row.activeTo ?? '-'}` },
        { key: 'enabled', header: t('common.status'), render: (row) => (row.enabled ? 'enabled' : 'disabled') },
      ]}
    />
  );
}
