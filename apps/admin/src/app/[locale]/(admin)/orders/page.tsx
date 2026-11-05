'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, PageHeader, Select, useToast } from '@b2b/ui';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';
import { quotationOrderApi } from '../../../../lib/quotation-order-api';
import type { CalculatorExcelTemplateOption } from '../../../../lib/quotation-order-api';
import { AdminApiError } from '../../../../lib/admin-api';
import { translateError } from '../../../../lib/i18n';

type Row = {
  id: string;
  orderNo: string;
  status: string;
  currencyCode: string;
  totalAmountCny: string;
  totalAmountForeign: string;
  orderDate: string;
};

export default function OrdersPage() {
  const { t, can, locale } = useSession();
  const breadcrumb = useBreadcrumb();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<CalculatorExcelTemplateOption[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [templateLoading, setTemplateLoading] = useState(false);
  const [exportBusyId, setExportBusyId] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows((await quotationOrderApi.orders()).data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('quotationCenter.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!can('order.read')) return;
    let active = true;
    setTemplateLoading(true);
    void quotationOrderApi
      .orderExcelTemplates()
      .then((nextTemplates) => {
        if (!active) return;
        setTemplates(nextTemplates);
        setTemplateId((current) =>
          nextTemplates.some((template) => template.id === current)
            ? current
            : (nextTemplates[0]?.id ?? ''),
        );
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : t('quotationCenter.loadError'));
      })
      .finally(() => {
        if (active) setTemplateLoading(false);
      });
    return () => {
      active = false;
    };
  }, [can, t]);

  const exportExcel = async (row: Row) => {
    if (!templateId) return;
    setExportBusyId(row.id);
    setError('');
    try {
      const file = await quotationOrderApi.exportOrderExcel(row.id, templateId);
      quotationOrderApi.saveQuotationExcelDownload(file);
      toast.success(t('quotationCenter.excelExported'));
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : cause instanceof Error
            ? cause.message
            : t('quotationCenter.excelExportFailed'),
      );
    } finally {
      setExportBusyId('');
    }
  };
  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('quotationCenter.ordersTitle')}
        description={t('quotationCenter.ordersDescription')}
        actions={
          <Button variant="secondary" loading={loading} onClick={() => void load()}>
            {t('quotationCenter.refresh')}
          </Button>
        }
      />
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {can('order.read') ? (
        <section className="panel stack-sm">
          <label className="field">
            <span className="field-label">{t('quotationCenter.excelTemplate')}</span>
            <Select
              value={templateId}
              disabled={templateLoading || templates.length === 0 || Boolean(exportBusyId)}
              options={templates.map((template) => ({
                value: template.id,
                label: `${template.name} v${template.version}`,
              }))}
              onChange={(event) => setTemplateId(event.target.value)}
            />
          </label>
          {templates.length === 0 && !templateLoading ? (
            <p className="muted">{t('quotationCenter.noExcelTemplate')}</p>
          ) : null}
        </section>
      ) : null}
      <section className="panel table-scroll" aria-live="polite">
        {loading ? (
          <p>{t('quotationCenter.loading')}</p>
        ) : rows.length === 0 ? (
          <p>{t('quotationCenter.noOrders')}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('quotationCenter.orderNo')}</th>
                <th>{t('quotationCenter.status')}</th>
                <th>{t('quotationCenter.orderDate')}</th>
                <th>{t('quotationCenter.totalCny')}</th>
                <th>{t('quotationCenter.totalForeign')}</th>
                <th>{t('quotationCenter.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.orderNo}</td>
                  <td>{row.status}</td>
                  <td>{row.orderDate}</td>
                  <td>{row.totalAmountCny}</td>
                  <td>
                    {row.totalAmountForeign} {row.currencyCode}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={exportBusyId === row.id}
                      disabled={Boolean(exportBusyId) || !templateId}
                      onClick={() => void exportExcel(row)}
                    >
                      {t('quotationCenter.exportExcel')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
