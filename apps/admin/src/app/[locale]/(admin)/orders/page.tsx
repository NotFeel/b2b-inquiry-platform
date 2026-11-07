'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Checkbox,
  Drawer,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Tabs,
  TabPanel,
  useToast,
} from '@b2b/ui';
import type { PaginatedResponse } from '../../../../lib/admin-api';
import { AdminApiError } from '../../../../lib/admin-api';
import { commercialDocumentsApi } from '../../../../lib/commercial-documents-api';
import {
  commercialDocumentFieldLabel,
  commercialDocumentLocaleLabel,
} from '../../../../lib/commercial-document-labels';
import type {
  DocumentParty,
  DocumentPrefill,
  OrderDetail,
  OrderListRow,
} from '../../../../lib/commercial-documents-api';
import { quotationOrderApi } from '../../../../lib/quotation-order-api';
import type { CalculatorExcelTemplateOption } from '../../../../lib/quotation-order-api';
import { localeHref, translateError } from '../../../../lib/i18n';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';

type DocumentType = 'PI' | 'CI';

interface PartyForm {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  taxId: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
}

const emptyParty: PartyForm = {
  companyName: '',
  contactName: '',
  phone: '',
  email: '',
  taxId: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  countryCode: '',
};

function partyToForm(party: DocumentParty | null | undefined): PartyForm {
  const address = party?.billingAddress ?? party?.shippingAddress ?? party?.address ?? null;
  return {
    companyName: String(party?.companyName ?? ''),
    contactName: String(party?.contactName ?? ''),
    phone: String(party?.phone ?? ''),
    email: String(party?.email ?? ''),
    taxId: String(party?.taxId ?? ''),
    line1: String(address?.line1 ?? ''),
    line2: String(address?.line2 ?? ''),
    city: String(address?.city ?? ''),
    state: String(address?.state ?? ''),
    postalCode: String(address?.postalCode ?? ''),
    countryCode: String(address?.countryCode ?? party?.countryCode ?? ''),
  };
}

function formatAddress(party: DocumentParty | null | undefined): string {
  const address = party?.billingAddress ?? party?.shippingAddress ?? party?.address ?? null;
  if (!address) return '—';
  return [
    address.companyName,
    address.recipient,
    address.line1,
    address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
    address.countryCode,
  ]
    .filter((value) => Boolean(value && String(value).trim()))
    .join('\n');
}

function documentTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'ISSUED':
      return 'success';
    case 'CANCELLED':
      return 'danger';
    case 'REVIEW':
      return 'warning';
    default:
      return 'neutral';
  }
}

export default function OrdersPage() {
  const { t, can, locale } = useSession();
  const breadcrumb = useBreadcrumb();
  const toast = useToast();
  const router = useRouter();

  const [rows, setRows] = useState<OrderListRow[]>([]);
  const [pagination, setPagination] = useState<PaginatedResponse<OrderListRow>['pagination']>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    q: '',
    status: '',
    currency: '',
    country: '',
    from: '',
    to: '',
    hasPi: '',
    hasCi: '',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [templates, setTemplates] = useState<CalculatorExcelTemplateOption[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [exportBusyId, setExportBusyId] = useState('');

  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  const [editOpen, setEditOpen] = useState(false);
  const [buyerForm, setBuyerForm] = useState<PartyForm>(emptyParty);
  const [consigneeForm, setConsigneeForm] = useState<PartyForm>(emptyParty);
  const [referenceForm, setReferenceForm] = useState({
    buyerReference: '',
    contractNo: '',
    incotermCode: '',
    namedPlace: '',
    paymentTerms: '',
  });
  const [syncProfile, setSyncProfile] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const [createType, setCreateType] = useState<DocumentType | null>(null);
  const [createOrderId, setCreateOrderId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<DocumentPrefill | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [createTemplateVersionId, setCreateTemplateVersionId] = useState('');
  const [createLocale, setCreateLocale] = useState('en-US');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const canEditCustomer = can('order.customer_snapshot.update');
  const canCreateDocument = can('commercial_document.create');
  const canSyncProfile = can('order.customer_profile.sync') && can('customer.update');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRequestId(null);
    try {
      const result = await commercialDocumentsApi.orders({
        page,
        pageSize,
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.currency ? { currency: filters.currency } : {}),
        ...(filters.country ? { country: filters.country } : {}),
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.hasPi ? { hasPi: filters.hasPi } : {}),
        ...(filters.hasCi ? { hasCi: filters.hasCi } : {}),
      });
      setRows(result.data);
      setPagination(result.pagination);
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('commercialDocuments.orders.loadError'),
      );
      setRequestId(cause instanceof AdminApiError ? (cause.requestId ?? null) : null);
    } finally {
      setLoading(false);
    }
  }, [filters, locale, page, pageSize, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!can('order.read')) return;
    let active = true;
    void quotationOrderApi
      .orderExcelTemplates()
      .then((next) => {
        if (!active) return;
        setTemplates(next);
        setTemplateId((current) =>
          next.some((template) => template.id === current) ? current : (next[0]?.id ?? ''),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [can]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setActiveTab('overview');
    try {
      setDetail(await commercialDocumentsApi.orderDetail(id));
    } catch (cause) {
      setDetailError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('commercialDocuments.orders.loadError'),
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const startEdit = () => {
    if (!detail) return;
    setBuyerForm(partyToForm(detail.buyer));
    setConsigneeForm(partyToForm(detail.consignee));
    const trade = detail.trade ?? {};
    setReferenceForm({
      buyerReference: detail.buyerReference ?? '',
      contractNo: detail.contractNo ?? '',
      incotermCode: String(trade.incotermCode ?? ''),
      namedPlace: String(trade.namedPlace ?? ''),
      paymentTerms: String(trade.paymentTerms ?? ''),
    });
    setSyncProfile(false);
    setEditError(null);
    setEditOpen(true);
  };

  const buildParty = (form: PartyForm, kind: 'buyer' | 'consignee') => ({
    companyName: form.companyName.trim() || null,
    contactName: form.contactName.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    taxId: form.taxId.trim() || null,
    countryCode: form.countryCode.trim().toUpperCase() || null,
    ...(kind === 'buyer'
      ? {
          billingAddress: {
            companyName: form.companyName.trim() || null,
            recipient: form.contactName.trim() || null,
            line1: form.line1.trim() || null,
            line2: form.line2.trim() || null,
            city: form.city.trim() || null,
            state: form.state.trim() || null,
            postalCode: form.postalCode.trim() || null,
            countryCode: form.countryCode.trim().toUpperCase() || null,
          },
        }
      : {
          shippingAddress: {
            companyName: form.companyName.trim() || null,
            recipient: form.contactName.trim() || null,
            line1: form.line1.trim() || null,
            line2: form.line2.trim() || null,
            city: form.city.trim() || null,
            state: form.state.trim() || null,
            postalCode: form.postalCode.trim() || null,
            countryCode: form.countryCode.trim().toUpperCase() || null,
          },
        }),
  });

  const saveCorrection = async () => {
    if (!detail) return;
    if (!buyerForm.phone.trim() || !buyerForm.line1.trim() || !buyerForm.city.trim()) {
      setEditError(`${t('commercialDocuments.orderEditor.buyerSection')}: ${t('errors.VALIDATION_FAILED')}`);
      return;
    }
    if (!consigneeForm.line1.trim() || !consigneeForm.city.trim()) {
      setEditError(
        `${t('commercialDocuments.orderEditor.consigneeSection')}: ${t('errors.VALIDATION_FAILED')}`,
      );
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const updated = await commercialDocumentsApi.updateOrderCustomerSnapshot(detail.id, {
        version: detail.version,
        buyer: buildParty(buyerForm, 'buyer'),
        consignee: buildParty(consigneeForm, 'consignee'),
        buyerReference: referenceForm.buyerReference.trim() || null,
        contractNo: referenceForm.contractNo.trim() || null,
        trade: {
          incotermCode: referenceForm.incotermCode || null,
          namedPlace: referenceForm.namedPlace.trim() || null,
          paymentTerms: referenceForm.paymentTerms.trim() || null,
        },
      });
      setDetail(updated);
      if (syncProfile && canSyncProfile) {
        try {
          await commercialDocumentsApi.syncOrderCustomerProfile(updated.id, updated.version);
          toast.success(t('commercialDocuments.orderEditor.synced'));
        } catch (cause) {
          toast.error(
            cause instanceof AdminApiError
              ? translateError(locale, cause.code)
              : t('errors.INTERNAL_ERROR'),
          );
        }
      }
      toast.success(t('commercialDocuments.orderEditor.saved'));
      setEditOpen(false);
      await load();
    } catch (cause) {
      setEditError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setEditBusy(false);
    }
  };

  const openCreate = async (type: DocumentType, orderId: string) => {
    setCreateType(type);
    setCreateOrderId(orderId);
    setCreateError(null);
    setPrefill(null);
    setPrefillLoading(true);
    try {
      const data = await commercialDocumentsApi.prefill(orderId, type);
      setPrefill(data);
      setCreateTemplateVersionId(data.template.versionId);
      setCreateLocale(data.template.locale);
    } catch (cause) {
      setCreateError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setPrefillLoading(false);
    }
  };

  const createDocument = async () => {
    if (!createType || !createOrderId) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await commercialDocumentsApi.createFromOrder(createOrderId, {
        documentType: createType,
        locale: createLocale,
        templateVersionId: createTemplateVersionId || null,
      });
      toast.success(t('common.saved'));
      setCreateType(null);
      router.push(localeHref(locale, `/commercial-documents/${created.id}`));
    } catch (cause) {
      setCreateError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setCreateBusy(false);
    }
  };

  const exportExcel = async (row: OrderListRow) => {
    if (!templateId) return;
    setExportBusyId(row.id);
    try {
      const file = await quotationOrderApi.exportOrderExcel(row.id, templateId);
      quotationOrderApi.saveQuotationExcelDownload(file);
      toast.success(t('quotationCenter.excelExported'));
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('quotationCenter.excelExportFailed'),
      );
    } finally {
      setExportBusyId('');
    }
  };

  const tabItems = useMemo(
    () => [
      { id: 'overview', label: t('commercialDocuments.orderDetail.overview') },
      { id: 'customer', label: t('commercialDocuments.orderDetail.customer') },
      {
        id: 'items',
        label: t('commercialDocuments.orderDetail.items'),
        badge: String(detail?.items.length ?? 0),
      },
      { id: 'charges', label: t('commercialDocuments.orderDetail.charges') },
      {
        id: 'documents',
        label: t('commercialDocuments.orderDetail.documents'),
        badge: String(detail?.documents.length ?? 0),
      },
      { id: 'audit', label: t('commercialDocuments.orderDetail.audit') },
    ],
    [detail, t],
  );

  const hasIssued = detail?.documents.some((document) => document.status === 'ISSUED') ?? false;

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('commercialDocuments.orders.title')}
        description={t('commercialDocuments.orders.description')}
        actions={
          <Button variant="secondary" loading={loading} onClick={() => void load()}>
            {t('commercialDocuments.orders.refresh')}
          </Button>
        }
      />

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
          {requestId ? <span className="mono"> · {requestId}</span> : null}
        </div>
      ) : null}

      <section className="panel stack-sm" aria-label={t('commercialDocuments.orders.search')}>
        <div className="form-grid">
          <Field label={t('commercialDocuments.orders.search')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={filters.q}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, q: event.target.value }));
                }}
                maxLength={120}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.orders.status')}>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={filters.status}
                placeholder={t('commercialDocuments.orders.any')}
                options={[
                  { value: 'CONFIRMED', label: 'CONFIRMED' },
                  { value: 'CANCELLED', label: 'CANCELLED' },
                ]}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, status: event.target.value }));
                }}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.orders.currency')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={filters.currency}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({
                    ...current,
                    currency: event.target.value.toUpperCase().slice(0, 3),
                  }));
                }}
                maxLength={3}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.orders.country')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={filters.country}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({
                    ...current,
                    country: event.target.value.toUpperCase().slice(0, 2),
                  }));
                }}
                maxLength={2}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.orders.from')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="date"
                value={filters.from}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, from: event.target.value }));
                }}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.orders.to')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="date"
                value={filters.to}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, to: event.target.value }));
                }}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.orders.hasPi')}>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={filters.hasPi}
                placeholder={t('commercialDocuments.orders.any')}
                options={[
                  { value: 'true', label: t('commercialDocuments.orders.yes') },
                  { value: 'false', label: t('commercialDocuments.orders.no') },
                ]}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, hasPi: event.target.value }));
                }}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.orders.hasCi')}>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={filters.hasCi}
                placeholder={t('commercialDocuments.orders.any')}
                options={[
                  { value: 'true', label: t('commercialDocuments.orders.yes') },
                  { value: 'false', label: t('commercialDocuments.orders.no') },
                ]}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, hasCi: event.target.value }));
                }}
              />
            )}
          </Field>
        </div>
        {can('order.read') ? (
          <div className="row-between">
            <label className="field" style={{ maxWidth: 340 }}>
              <span className="field-label">{t('quotationCenter.excelTemplate')}</span>
              <Select
                value={templateId}
                disabled={templates.length === 0}
                options={templates.map((template) => ({
                  value: template.id,
                  label: `${template.name} v${template.version}`,
                }))}
                onChange={(event) => setTemplateId(event.target.value)}
              />
            </label>
            <span className="muted">
              {templates.length === 0 ? t('quotationCenter.noExcelTemplate') : ''}
            </span>
          </div>
        ) : null}
      </section>

      <section className="panel table-scroll" aria-live="polite">
        {loading ? (
          <p>{t('commercialDocuments.orders.loading')}</p>
        ) : rows.length === 0 ? (
          <p>{t('commercialDocuments.orders.empty')}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('commercialDocuments.columns.orderNo')}</th>
                <th>{t('commercialDocuments.columns.customer')}</th>
                <th>{t('commercialDocuments.columns.contact')}</th>
                <th>{t('commercialDocuments.columns.country')}</th>
                <th>{t('commercialDocuments.columns.orderDate')}</th>
                <th>{t('commercialDocuments.columns.status')}</th>
                <th>{t('commercialDocuments.columns.currency')}</th>
                <th>{t('commercialDocuments.columns.total')}</th>
                <th>{t('commercialDocuments.columns.documents')}</th>
                <th>{t('commercialDocuments.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">
                    <button type="button" className="link-button" onClick={() => void openDetail(row.id)}>
                      {row.orderNo}
                    </button>
                  </td>
                  <td>{String(row.buyer?.companyName ?? '—')}</td>
                  <td>{String(row.buyer?.contactName ?? '—')}</td>
                  <td>{String(row.buyer?.countryCode ?? '—')}</td>
                  <td>{row.orderDate}</td>
                  <td>
                    <Badge tone={row.status === 'CANCELLED' ? 'danger' : 'success'}>
                      {row.status}
                    </Badge>
                  </td>
                  <td>{row.currencyCode}</td>
                  <td className="mono">
                    {row.totalAmountForeign} {row.currencyCode}
                  </td>
                  <td>
                    {t('commercialDocuments.orders.documents', {
                      pi: row.documents?.piCount ?? 0,
                      ci: row.documents?.ciCount ?? 0,
                    })}
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button size="sm" variant="ghost" onClick={() => void openDetail(row.id)}>
                        {t('commercialDocuments.orders.view')}
                      </Button>
                      {canCreateDocument && row.status === 'CONFIRMED' ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void openDetail(row.id).then(() => openCreate('PI', row.id))}
                          >
                            {t('commercialDocuments.orders.createPi')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void openDetail(row.id).then(() => openCreate('CI', row.id))}
                          >
                            {t('commercialDocuments.orders.createCi')}
                          </Button>
                        </>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={exportBusyId === row.id}
                        disabled={!templateId || Boolean(exportBusyId)}
                        onClick={() => void exportExcel(row)}
                      >
                        {t('commercialDocuments.orders.exportExcel')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPage(1);
            setPageSize(size);
          }}
          labels={{
            previous: t('common.previous'),
            next: t('common.next'),
            rowsPerPage: t('common.rowsPerPage'),
            range: t('list.range', {
              from: (pagination.page - 1) * pagination.pageSize + 1,
              to: Math.min(pagination.page * pagination.pageSize, pagination.total),
              total: pagination.total,
            }),
          }}
        />
      </section>

      <Drawer
        open={Boolean(detail) || detailLoading}
        title={detail?.orderNo ?? t('commercialDocuments.orderDetail.title')}
        onClose={() => {
          setDetail(null);
          setDetailError(null);
        }}
        closeLabel={t('common.close')}
        footer={
          detail ? (
            <div className="row-actions">
              {canEditCustomer && detail.status === 'CONFIRMED' ? (
                <Button variant="secondary" onClick={startEdit}>
                  {t('commercialDocuments.orderDetail.editCustomer')}
                </Button>
              ) : null}
              {canCreateDocument && detail.status === 'CONFIRMED' ? (
                <>
                  <Button variant="secondary" onClick={() => void openCreate('PI', detail.id)}>
                    {t('commercialDocuments.orderDetail.createPi')}
                  </Button>
                  <Button onClick={() => void openCreate('CI', detail.id)}>
                    {t('commercialDocuments.orderDetail.createCi')}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null
        }
      >
        {detailLoading ? <p>{t('quotationCenter.loading')}</p> : null}
        {detailError ? (
          <div className="alert alert-error" role="alert">
            {detailError}
          </div>
        ) : null}
        {detail ? (
          <div className="stack-sm">
            {hasIssued ? (
              <div className="alert alert-warning">{t('commercialDocuments.orderEditor.issuedHint')}</div>
            ) : null}
            <Tabs
              items={tabItems}
              activeId={activeTab}
              onChange={setActiveTab}
              ariaLabel={t('commercialDocuments.orderDetail.title')}
            />
            <TabPanel id="overview" activeId={activeTab}>
              <dl className="definition-list">
                <dt>{t('commercialDocuments.orderDetail.orderNo')}</dt>
                <dd className="mono">{detail.orderNo}</dd>
                <dt>{t('commercialDocuments.orderDetail.status')}</dt>
                <dd>{detail.status}</dd>
                <dt>{t('commercialDocuments.orderDetail.orderDate')}</dt>
                <dd>{detail.orderDate}</dd>
                <dt>{t('commercialDocuments.orderDetail.currency')}</dt>
                <dd>{detail.currencyCode}</dd>
                <dt>{t('commercialDocuments.orderDetail.totalCny')}</dt>
                <dd className="mono">{detail.totalAmountCny}</dd>
                <dt>{t('commercialDocuments.orderDetail.totalForeign')}</dt>
                <dd className="mono">
                  {detail.totalAmountForeign} {detail.currencyCode}
                </dd>
                <dt>{t('commercialDocuments.orderDetail.version')}</dt>
                <dd>{detail.version}</dd>
              </dl>
            </TabPanel>
            <TabPanel id="customer" activeId={activeTab}>
              <div className="stack-sm">
                <h3>{t('commercialDocuments.orderDetail.buyer')}</h3>
                <pre className="pre-wrap">{formatAddress(detail.buyer)}</pre>
                <p>
                  {String(detail.buyer?.contactName ?? '')} · {String(detail.buyer?.phone ?? '')} ·{' '}
                  {String(detail.buyer?.email ?? '')}
                </p>
                <h3>{t('commercialDocuments.orderDetail.consignee')}</h3>
                <pre className="pre-wrap">{formatAddress(detail.consignee)}</pre>
                {detail.notifyParty ? (
                  <>
                    <h3>{t('commercialDocuments.orderDetail.notifyParty')}</h3>
                    <pre className="pre-wrap">{formatAddress(detail.notifyParty)}</pre>
                  </>
                ) : null}
                <h3>{t('commercialDocuments.orderDetail.trade')}</h3>
                <dl className="definition-list">
                  <dt>{t('commercialDocuments.orderDetail.incoterm')}</dt>
                  <dd>{String(detail.trade?.incotermCode ?? '—')}</dd>
                  <dt>{t('commercialDocuments.orderDetail.namedPlace')}</dt>
                  <dd>{String(detail.trade?.namedPlace ?? '—')}</dd>
                  <dt>{t('commercialDocuments.orderDetail.paymentTerms')}</dt>
                  <dd>{String(detail.trade?.paymentTerms ?? '—')}</dd>
                  <dt>{t('commercialDocuments.orderDetail.buyerReference')}</dt>
                  <dd>{detail.buyerReference ?? '—'}</dd>
                  <dt>{t('commercialDocuments.orderDetail.contractNo')}</dt>
                  <dd>{detail.contractNo ?? '—'}</dd>
                </dl>
              </div>
            </TabPanel>
            <TabPanel id="items" activeId={activeTab}>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>SKU</th>
                      <th>{t('quotationCenter.productName')}</th>
                      <th>{t('quotationCenter.totalQuantity')}</th>
                      <th>{t('quotationCenter.cartons')}</th>
                      <th>{t('quotationCenter.dimensions')}</th>
                      <th>{t('quotationCenter.totalCbm')}</th>
                      <th>{t('quotationCenter.cartonWeight')}</th>
                      <th>{t('quotationCenter.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.lineNo}</td>
                        <td className="mono">{item.sku}</td>
                        <td>{item.productName}</td>
                        <td>{item.quantity}</td>
                        <td>{item.packaging?.cartonCount ?? '—'}</td>
                        <td>
                          {item.packaging?.cartonLengthCm ?? '—'} × {item.packaging?.cartonWidthCm ?? '—'} ×{' '}
                          {item.packaging?.cartonHeightCm ?? '—'} cm
                        </td>
                        <td>{item.packaging?.totalCbm ?? '—'}</td>
                        <td>{item.packaging?.cartonGrossWeightKg ?? '—'}</td>
                        <td className="mono">
                          {item.lineAmountForeign} {detail.currencyCode}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabPanel>
            <TabPanel id="charges" activeId={activeTab}>
              <dl className="definition-list">
                <dt>{t('commercialDocuments.orderDetail.exchangeRate')}</dt>
                <dd>
                  1 CNY = {detail.exchangeRate} {detail.currencyCode} ({detail.exchangeRateDate})
                </dd>
                <dt>{t('commercialDocuments.orderDetail.fees')}</dt>
                <dd>
                  <ul>
                    {detail.fees.map((fee) => (
                      <li key={fee.id}>
                        {fee.name}: {fee.amountForeign} {detail.currencyCode}
                      </li>
                    ))}
                    {detail.fees.length === 0 ? <li>—</li> : null}
                  </ul>
                </dd>
              </dl>
            </TabPanel>
            <TabPanel id="documents" activeId={activeTab}>
              {detail.documents.length === 0 ? (
                <p>{t('commercialDocuments.orderDetail.noDocuments')}</p>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('commercialDocuments.columns.documentNo')}</th>
                        <th>{t('commercialDocuments.columns.type')}</th>
                        <th>{t('commercialDocuments.columns.revision')}</th>
                        <th>{t('commercialDocuments.columns.status')}</th>
                        <th>{t('commercialDocuments.columns.total')}</th>
                        <th>{t('commercialDocuments.columns.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.documents.map((document) => (
                        <tr key={document.id}>
                          <td className="mono">{document.documentNo}</td>
                          <td>{document.type}</td>
                          <td>R{document.revisionNo}</td>
                          <td>
                            <Badge tone={documentTone(document.status)}>{document.status}</Badge>
                          </td>
                          <td className="mono">
                            {document.totalAmount} {document.currency}
                          </td>
                          <td>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                router.push(localeHref(locale, `/commercial-documents/${document.id}`))
                              }
                            >
                              {t('commercialDocuments.actions.open')}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabPanel>
            <TabPanel id="audit" activeId={activeTab}>
              {detail.auditTrail.length === 0 ? (
                <p>{t('commercialDocuments.orderDetail.noAudit')}</p>
              ) : (
                <ul className="timeline">
                  {detail.auditTrail.map((entry) => (
                    <li key={entry.id}>
                      <span className="mono">{entry.createdAt}</span> · {entry.actor ?? '—'} ·{' '}
                      {entry.action}
                    </li>
                  ))}
                </ul>
              )}
            </TabPanel>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={editOpen}
        title={t('commercialDocuments.orderEditor.title')}
        size="lg"
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={editBusy}>
              {t('common.cancel')}
            </Button>
            <Button loading={editBusy} onClick={() => void saveCorrection()}>
              {t('commercialDocuments.orderEditor.save')}
            </Button>
          </>
        }
      >
        <div className="stack-sm">
          <p className="muted">{t('commercialDocuments.orderEditor.description')}</p>
          {editError ? (
            <div className="alert alert-error" role="alert">
              {editError}
            </div>
          ) : null}
          <h3>{t('commercialDocuments.orderEditor.buyerSection')}</h3>
          <PartyFields form={buyerForm} setForm={setBuyerForm} t={t} prefix="buyer" />
          <h3>{t('commercialDocuments.orderEditor.consigneeSection')}</h3>
          <PartyFields form={consigneeForm} setForm={setConsigneeForm} t={t} prefix="consignee" />
          <h3>{t('commercialDocuments.orderEditor.referenceSection')}</h3>
          <div className="form-grid">
            <Field label={t('quotationCenter.buyerReference')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={referenceForm.buyerReference}
                  onChange={(event) =>
                    setReferenceForm((current) => ({ ...current, buyerReference: event.target.value }))
                  }
                  maxLength={120}
                />
              )}
            </Field>
            <Field label={t('quotationCenter.contractNo')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={referenceForm.contractNo}
                  onChange={(event) =>
                    setReferenceForm((current) => ({ ...current, contractNo: event.target.value }))
                  }
                  maxLength={80}
                />
              )}
            </Field>
            <Field label={t('quotationCenter.incoterm')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={referenceForm.incotermCode}
                  placeholder={t('common.none')}
                  options={['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'].map(
                    (code) => ({ value: code, label: code }),
                  )}
                  onChange={(event) =>
                    setReferenceForm((current) => ({ ...current, incotermCode: event.target.value }))
                  }
                />
              )}
            </Field>
            <Field label={t('quotationCenter.namedPlace')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={referenceForm.namedPlace}
                  onChange={(event) =>
                    setReferenceForm((current) => ({ ...current, namedPlace: event.target.value }))
                  }
                  maxLength={240}
                />
              )}
            </Field>
            <Field label={t('quotationCenter.paymentTerms')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={referenceForm.paymentTerms}
                  onChange={(event) =>
                    setReferenceForm((current) => ({ ...current, paymentTerms: event.target.value }))
                  }
                  maxLength={500}
                />
              )}
            </Field>
          </div>
          {canSyncProfile ? (
            <Checkbox
              id="sync-profile"
              label={t('commercialDocuments.orderEditor.syncLabel')}
              help={t('commercialDocuments.orderEditor.syncHint')}
              checked={syncProfile}
              onChange={(event) => setSyncProfile(event.target.checked)}
            />
          ) : null}
        </div>
      </Modal>

      <Modal
        open={createType !== null}
        title={t('commercialDocuments.create.title')}
        size="md"
        onClose={() => setCreateType(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateType(null)} disabled={createBusy}>
              {t('common.cancel')}
            </Button>
            <Button loading={createBusy} disabled={!prefill} onClick={() => void createDocument()}>
              {t('commercialDocuments.create.create')}
            </Button>
          </>
        }
      >
        {prefillLoading ? <p>{t('quotationCenter.loading')}</p> : null}
        {createError ? (
          <div className="alert alert-error" role="alert">
            {createError}
          </div>
        ) : null}
        {prefill ? (
          <div className="stack-sm">
            <dl className="definition-list">
              <dt>{t('commercialDocuments.create.type')}</dt>
              <dd>{t(`commercialDocuments.types.${prefill.documentType}`)}</dd>
              <dt>{t('commercialDocuments.create.template')}</dt>
              <dd>
                {prefill.template.name} v{prefill.template.version}
              </dd>
              <dt>{t('commercialDocuments.columns.currency')}</dt>
              <dd>{prefill.currency}</dd>
              <dt>{t('commercialDocuments.editor.fields.total')}</dt>
              <dd className="mono">{prefill.totals.totalAmount}</dd>
            </dl>
            <Field label={t('commercialDocuments.create.template')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={createTemplateVersionId}
                  options={prefill.templateOptions.map((option) => ({
                    value: option.versionId,
                    label: `${option.name} v${option.version} · ${commercialDocumentLocaleLabel(option.locale, t)}`,
                  }))}
                  onChange={(event) => {
                    setCreateTemplateVersionId(event.target.value);
                    const selected = prefill.templateOptions.find(
                      (option) => option.versionId === event.target.value,
                    );
                    if (selected) setCreateLocale(selected.locale);
                  }}
                />
              )}
            </Field>
            <Field label={t('commercialDocuments.create.locale')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={createLocale}
                  options={[
                    { value: 'en-US', label: commercialDocumentLocaleLabel('en-US', t) },
                    { value: 'zh-CN', label: commercialDocumentLocaleLabel('zh-CN', t) },
                  ]}
                  onChange={(event) => setCreateLocale(event.target.value)}
                />
              )}
            </Field>
            {prefill.missingFields.length > 0 || prefill.missingItemLines.length > 0 ? (
              <div className="alert alert-warning">
                <strong>{t('commercialDocuments.create.missing')}</strong>
                <ul>
                  {prefill.missingFieldLabels.map((field) => (
                    <li key={field.key}>{commercialDocumentFieldLabel(field.key, t)}</li>
                  ))}
                  {prefill.missingItemLines.map((line) => (
                    <li key={`line-${line.lineNo}`}>
                      {t('commercialDocuments.editor.missingItemLine', {
                        line: line.lineNo,
                        fields: line.fields
                          .map((field) => commercialDocumentFieldLabel(field, t))
                          .join(', '),
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function PartyFields({
  form,
  setForm,
  t,
  prefix,
}: {
  form: PartyForm;
  setForm: (updater: (current: PartyForm) => PartyForm) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  prefix: string;
}) {
  const update = (key: keyof PartyForm) => (event: ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <div className="form-grid">
      <Field label={t('commercialDocuments.editor.fields.companyName')}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            value={form.companyName}
            onChange={update('companyName')}
            maxLength={240}
          />
        )}
      </Field>
      <Field label={t('commercialDocuments.editor.fields.contactName')}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            value={form.contactName}
            onChange={update('contactName')}
            maxLength={160}
          />
        )}
      </Field>
      <Field label={t('commercialDocuments.editor.fields.phone')}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            value={form.phone}
            onChange={update('phone')}
            maxLength={24}
          />
        )}
      </Field>
      <Field label={t('commercialDocuments.editor.fields.email')}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            type="email"
            value={form.email}
            onChange={update('email')}
            maxLength={254}
          />
        )}
      </Field>
      <Field label={t('commercialDocuments.editor.fields.taxId')}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            value={form.taxId}
            onChange={update('taxId')}
            maxLength={60}
          />
        )}
      </Field>
      <Field label={t('commercialDocuments.editor.fields.addressLine1')}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            value={form.line1}
            onChange={update('line1')}
            maxLength={240}
          />
        )}
      </Field>
      <Field label={t('commercialDocuments.editor.fields.addressLine2')}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            value={form.line2}
            onChange={update('line2')}
            maxLength={240}
          />
        )}
      </Field>
      <Field label={t('commercialDocuments.editor.fields.city')}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            value={form.city}
            onChange={update('city')}
            maxLength={120}
          />
        )}
      </Field>
      <Field label={t('commercialDocuments.editor.fields.state')}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            value={form.state}
            onChange={update('state')}
            maxLength={120}
          />
        )}
      </Field>
      <Field label={t('commercialDocuments.editor.fields.postalCode')}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            value={form.postalCode}
            onChange={update('postalCode')}
            maxLength={40}
          />
        )}
      </Field>
      <Field label={t('commercialDocuments.editor.fields.countryCode')}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            value={form.countryCode}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                countryCode: event.target.value.toUpperCase().slice(0, 2),
              }))
            }
            maxLength={2}
            aria-label={`${prefix} country`}
          />
        )}
      </Field>
    </div>
  );
}
