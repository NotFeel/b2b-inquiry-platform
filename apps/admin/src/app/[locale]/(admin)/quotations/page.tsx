'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, PageHeader, useToast } from '@b2b/ui';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';
import { localeHref } from '../../../../lib/i18n';
import { quotationOrderApi } from '../../../../lib/quotation-order-api';

type Row = {
  id: string;
  quotationNo: string;
  title: string;
  status: string;
  currencyCode: string;
  totalAmountCny: string;
  totalAmountForeign: string;
  createdAt: string;
};

export default function QuotationsPage() {
  const { t, can, locale } = useSession();
  const breadcrumb = useBreadcrumb();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows((await quotationOrderApi.quotations()).data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('quotationCenter.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const convert = async (row: Row) => {
    setBusyId(row.id);
    try {
      const result = await quotationOrderApi.convert(row.id);
      toast.success(t('quotationCenter.orderCreated', { number: result.orderNo }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('quotationCenter.saveError'));
    } finally {
      setBusyId('');
    }
  };
  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('quotationCenter.quotationsTitle')}
        description={t('quotationCenter.quotationsDescription')}
        actions={
          <>
            <Link
              className="button button-primary"
              href={localeHref(locale, '/quotation-calculator')}
            >
              {t('quotationCenter.openCalculator')}
            </Link>
            <Button variant="secondary" loading={loading} onClick={() => void load()}>
              {t('quotationCenter.refresh')}
            </Button>
          </>
        }
      />
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      <section className="panel table-scroll" aria-live="polite">
        {loading ? (
          <p>{t('quotationCenter.loading')}</p>
        ) : rows.length === 0 ? (
          <p>{t('quotationCenter.noQuotations')}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('quotationCenter.quotationNo')}</th>
                <th>{t('quotationCenter.titleField')}</th>
                <th>{t('quotationCenter.status')}</th>
                <th>{t('quotationCenter.totalCny')}</th>
                <th>{t('quotationCenter.totalForeign')}</th>
                <th>{t('quotationCenter.createdAt')}</th>
                <th>{t('quotationCenter.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.quotationNo}</td>
                  <td>{row.title}</td>
                  <td>{row.status}</td>
                  <td>{row.totalAmountCny}</td>
                  <td>
                    {row.totalAmountForeign} {row.currencyCode}
                  </td>
                  <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                  <td>
                    {can('quotation.convert_to_order') && row.status === 'DRAFT' ? (
                      <Button
                        size="sm"
                        loading={busyId === row.id}
                        disabled={Boolean(busyId)}
                        onClick={() => void convert(row)}
                      >
                        {t('quotationCenter.convertToOrder')}
                      </Button>
                    ) : null}
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
