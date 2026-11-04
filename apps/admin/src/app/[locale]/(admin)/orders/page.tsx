'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, PageHeader } from '@b2b/ui';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';
import { quotationOrderApi } from '../../../../lib/quotation-order-api';

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
  const { t } = useSession();
  const breadcrumb = useBreadcrumb();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
