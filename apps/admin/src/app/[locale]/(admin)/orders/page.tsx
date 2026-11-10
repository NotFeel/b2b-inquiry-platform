'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Badge,
  Button,
  Checkbox,
  Drawer,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Tabs,
  TabPanel,
  useToast,
} from '@b2b/ui';
import type { PaginatedResponse } from '../../../../lib/admin-api';
import { AdminApiError } from '../../../../lib/admin-api';
import { commercialDocumentsApi } from '../../../../lib/commercial-documents-api';
import { commercialDocumentLocaleLabel } from '../../../../lib/commercial-document-labels';
import type {
  DocumentParty,
  DocumentPrefill,
  OrderDetail,
  OrderListRow,
} from '../../../../lib/commercial-documents-api';
import { quotationOrderApi } from '../../../../lib/quotation-order-api';
import type { CalculatorExcelTemplateOption } from '../../../../lib/quotation-order-api';
import { localeHref, translateError } from '../../../../lib/i18n';
import {
  EMPTY_ORDER_FILTERS,
  orderFiltersToQueryString,
  readOrderListFilters,
  type OrderFilterKey,
  type OrderListFilters,
} from '../../../../lib/order-list';
import {
  isCreateDocumentPrefillCurrent,
  preserveValidBankAccount,
} from '../../../../lib/order-document-create';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useViewport } from '../../../../components/use-viewport';
import { useSession } from '../../../../components/session-provider';
import { OrderListView } from '../../../../components/orders/order-list-view';
import { CommercialDocumentMissingFields } from '../../../../components/commercial-document-missing-fields';
import { CountrySelect } from '../../../../components/reference-selects';
import {
  buildCustomerChanges,
  type EditableCustomerSnapshot,
  type EditableParty,
} from '../../../../lib/order-customer-edit';

type DocumentType = 'PI' | 'CI';

type PartyForm = EditableParty;

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
  addressCountryCode: '',
};

function partyToForm(
  party: DocumentParty | null | undefined,
  kind: 'billing' | 'shipping' = 'billing',
): PartyForm {
  const address =
    kind === 'shipping'
      ? (party?.shippingAddress ?? party?.address ?? party?.billingAddress ?? null)
      : (party?.billingAddress ?? party?.address ?? party?.shippingAddress ?? null);
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
    countryCode: String(party?.countryCode ?? ''),
    addressCountryCode: String(address?.countryCode ?? party?.countryCode ?? ''),
  };
}

function formSnapshot(
  buyer: PartyForm,
  consignee: PartyForm,
  reference: {
    buyerReference: string;
    incotermCode: string;
    namedPlace: string;
    paymentTerms: string;
  },
): EditableCustomerSnapshot {
  return {
    buyer,
    consignee,
    buyerReference: reference.buyerReference,
    incotermCode: reference.incotermCode,
    namedPlace: reference.namedPlace,
    paymentTerms: reference.paymentTerms,
  };
}

function formatAddress(
  party: DocumentParty | null | undefined,
  kind: 'billing' | 'shipping' = 'billing',
): string {
  const address =
    kind === 'shipping'
      ? (party?.shippingAddress ?? party?.address ?? party?.billingAddress ?? null)
      : (party?.billingAddress ?? party?.address ?? party?.shippingAddress ?? null);
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewport = useViewport();

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
  const [filters, setFilters] = useState<OrderListFilters>(() =>
    readOrderListFilters(searchParams),
  );
  const [searchInput, setSearchInput] = useState(() => readOrderListFilters(searchParams).q);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  const [billingSameAsConsignee, setBillingSameAsConsignee] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editBase, setEditBase] = useState<EditableCustomerSnapshot | null>(null);
  const [conflictDetail, setConflictDetail] = useState<OrderDetail | null>(null);
  const [pendingSync, setPendingSync] = useState<{ orderId: string; version: number } | null>(null);
  const [syncPrompt, setSyncPrompt] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [createType, setCreateType] = useState<DocumentType | null>(null);
  const [createOrderId, setCreateOrderId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<DocumentPrefill | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [createTemplateVersionId, setCreateTemplateVersionId] = useState('');
  const [createLocale, setCreateLocale] = useState('en-US');
  const [createBankAccountId, setCreateBankAccountId] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const canEditCustomer = can('order.customer_snapshot.update');
  const canCreateDocument = can('commercial_document.create');
  const canSyncProfile = can('order.customer_profile.sync') && can('customer.update');

  const canReadOrders = can('order.read');
  const loadSequence = useRef(0);
  const detailSequence = useRef(0);
  const createPrefillSequence = useRef(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const syncUrl = useCallback(
    (next: OrderListFilters) => {
      const query = orderFiltersToQueryString(next);
      router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!canReadOrders) {
      setRows([]);
      setLoading(false);
      setError(null);
      setRequestId(null);
      return;
    }
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
      if (sequence !== loadSequence.current) return;
      setRows(result.data);
      setPagination(result.pagination);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('commercialDocuments.orders.loadError'),
      );
      setRequestId(cause instanceof AdminApiError ? (cause.requestId ?? null) : null);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [canReadOrders, filters, locale, page, pageSize, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back/forward navigation restores the filters encoded in the URL. The
  // comparison prevents our own router.replace from re-applying state.
  useEffect(() => {
    const next = readOrderListFilters(searchParams);
    if (orderFiltersToQueryString(next) === orderFiltersToQueryString(filtersRef.current)) {
      return;
    }
    setFilters(next);
    setSearchInput(next.q);
    setPage(1);
  }, [searchParams]);

  // Keep typing responsive while avoiding one request per keystroke (docs/43 §3.5).
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === filters.q) return undefined;
    const timer = window.setTimeout(() => {
      const next = { ...filters, q: trimmed };
      setPage(1);
      setFilters(next);
      syncUrl(next);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [filters, searchInput, syncUrl]);

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
    const sequence = ++detailSequence.current;
    setDetailLoading(true);
    setDetailError(null);
    setActiveTab('overview');
    try {
      const next = await commercialDocumentsApi.orderDetail(id);
      if (sequence !== detailSequence.current) return;
      setDetail(next);
    } catch (cause) {
      if (sequence !== detailSequence.current) return;
      setDetailError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('commercialDocuments.orders.loadError'),
      );
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false);
    }
  };

  const startEdit = () => {
    if (!detail) return;
    const buyer = partyToForm(detail.buyer);
    const consignee = partyToForm(detail.consignee, 'shipping');
    const trade = detail.trade ?? {};
    const reference = {
      buyerReference: detail.buyerReference ?? '',
      contractNo: detail.contractNo ?? '',
      incotermCode: String(trade.incotermCode ?? ''),
      namedPlace: String(trade.namedPlace ?? ''),
      paymentTerms: String(trade.paymentTerms ?? ''),
    };
    setBuyerForm(buyer);
    setConsigneeForm(consignee);
    setReferenceForm(reference);
    setEditBase(formSnapshot(buyer, consignee, reference));
    setConflictDetail(null);
    setPendingSync(null);
    setSyncPrompt(false);
    setSyncError(null);
    setBillingSameAsConsignee(false);
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
            countryCode: form.addressCountryCode.trim().toUpperCase() || null,
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
            countryCode: form.addressCountryCode.trim().toUpperCase() || null,
          },
        }),
  });

  const saveCorrection = async () => {
    if (!detail) return;
    if (!/^\+[1-9]\d{1,14}$/.test(buyerForm.phone.trim())) {
      setEditError(t('quotationCenter.orderPhoneInvalid'));
      return;
    }
    if (!buyerForm.line1.trim() || !buyerForm.city.trim()) {
      setEditError(
        `${t('commercialDocuments.orderEditor.buyerSection')}: ${t('errors.VALIDATION_FAILED')}`,
      );
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
    setSyncError(null);
    try {
      const updated = await commercialDocumentsApi.updateOrderCustomerSnapshot(detail.id, {
        version: detail.version,
        buyer: buildParty(buyerForm, 'buyer'),
        consignee: buildParty(consigneeForm, 'consignee'),
        buyerReference: referenceForm.buyerReference.trim() || null,
        trade: {
          incotermCode: referenceForm.incotermCode || null,
          namedPlace: referenceForm.namedPlace.trim() || null,
          paymentTerms: referenceForm.paymentTerms.trim() || null,
        },
      });
      setDetail(updated);
      setEditBase(formSnapshot(buyerForm, consigneeForm, referenceForm));
      setConflictDetail(null);
      toast.success(t('commercialDocuments.orderEditor.saved'));
      await load();
      if (syncProfile && canSyncProfile) {
        // The snapshot is saved first. Customer-master sync is a separate,
        // explicitly confirmed operation and may fail without losing the
        // correction (docs/43 §11.4).
        setPendingSync({ orderId: updated.id, version: updated.version });
        setSyncPrompt(true);
        return;
      }
      setEditOpen(false);
    } catch (cause) {
      if (
        cause instanceof AdminApiError &&
        (cause.code === 'ORDER_CONCURRENT_UPDATE' || cause.status === 409)
      ) {
        try {
          const latest = await commercialDocumentsApi.orderDetail(detail.id);
          setConflictDetail(latest);
          setEditError(t('commercialDocuments.orderEditor.conflictHint'));
        } catch {
          setEditError(t('commercialDocuments.orderEditor.conflictReloadFailed'));
        }
      } else {
        setEditError(
          cause instanceof AdminApiError
            ? translateError(locale, cause.code)
            : t('errors.INTERNAL_ERROR'),
        );
      }
    } finally {
      setEditBusy(false);
    }
  };

  const retrySync = async () => {
    if (!pendingSync) return;
    setEditBusy(true);
    setSyncPrompt(false);
    setSyncError(null);
    try {
      await commercialDocumentsApi.syncOrderCustomerProfile(
        pendingSync.orderId,
        pendingSync.version,
      );
      toast.success(t('commercialDocuments.orderEditor.synced'));
      setPendingSync(null);
      setSyncPrompt(false);
      setEditOpen(false);
      await load();
    } catch (cause) {
      setSyncError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setEditBusy(false);
    }
  };

  const useServerVersion = () => {
    if (!conflictDetail) return;
    const buyer = partyToForm(conflictDetail.buyer);
    const consignee = partyToForm(conflictDetail.consignee, 'shipping');
    const trade = conflictDetail.trade ?? {};
    const reference = {
      buyerReference: conflictDetail.buyerReference ?? '',
      contractNo: conflictDetail.contractNo ?? '',
      incotermCode: String(trade.incotermCode ?? ''),
      namedPlace: String(trade.namedPlace ?? ''),
      paymentTerms: String(trade.paymentTerms ?? ''),
    };
    setBuyerForm(buyer);
    setConsigneeForm(consignee);
    setReferenceForm(reference);
    setEditBase(formSnapshot(buyer, consignee, reference));
    setDetail(conflictDetail);
    setConflictDetail(null);
    setEditError(null);
  };

  const keepLocalAndRefreshVersion = () => {
    if (!conflictDetail) return;
    const buyer = partyToForm(conflictDetail.buyer);
    const consignee = partyToForm(conflictDetail.consignee, 'shipping');
    const trade = conflictDetail.trade ?? {};
    setEditBase(
      formSnapshot(buyer, consignee, {
        buyerReference: conflictDetail.buyerReference ?? '',
        incotermCode: String(trade.incotermCode ?? ''),
        namedPlace: String(trade.namedPlace ?? ''),
        paymentTerms: String(trade.paymentTerms ?? ''),
      }),
    );
    setDetail(conflictDetail);
    setReferenceForm((current) => ({
      ...current,
      contractNo: conflictDetail.contractNo ?? '',
    }));
    setConflictDetail(null);
    setEditError(t('commercialDocuments.orderEditor.conflictKeepHint'));
  };

  const currentSnapshot = formSnapshot(buyerForm, consigneeForm, referenceForm);
  const customerChanges = editBase ? buildCustomerChanges(editBase, currentSnapshot) : [];
  const conflictChanges = conflictDetail
    ? buildCustomerChanges(
        formSnapshot(
          partyToForm(conflictDetail.buyer),
          partyToForm(conflictDetail.consignee, 'shipping'),
          {
            buyerReference: conflictDetail.buyerReference ?? '',
            incotermCode: String((conflictDetail.trade ?? {}).incotermCode ?? ''),
            namedPlace: String((conflictDetail.trade ?? {}).namedPlace ?? ''),
            paymentTerms: String((conflictDetail.trade ?? {}).paymentTerms ?? ''),
          },
        ),
        currentSnapshot,
      )
    : [];

  const loadCreatePrefill = async ({
    orderId,
    type,
    templateVersionId,
    documentLocale,
    clearCurrent = false,
  }: {
    orderId: string;
    type: DocumentType;
    templateVersionId?: string;
    documentLocale?: string;
    clearCurrent?: boolean;
  }) => {
    const sequence = ++createPrefillSequence.current;
    if (clearCurrent) setPrefill(null);
    setCreateError(null);
    setPrefillLoading(true);
    try {
      const data = await commercialDocumentsApi.prefill(orderId, type, {
        templateVersionId,
        locale: documentLocale,
      });
      if (sequence !== createPrefillSequence.current) return;
      setPrefill(data);
      setCreateTemplateVersionId(data.resolvedTemplate.versionId);
      setCreateLocale(data.resolvedTemplate.locale);
      setCreateBankAccountId((current) =>
        preserveValidBankAccount(current, data.bankAccounts, data.bankAccountId),
      );
    } catch (cause) {
      if (sequence !== createPrefillSequence.current) return;
      setCreateError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      if (sequence === createPrefillSequence.current) setPrefillLoading(false);
    }
  };

  const openCreate = async (type: DocumentType, orderId: string) => {
    setCreateType(type);
    setCreateOrderId(orderId);
    setCreateTemplateVersionId('');
    setCreateLocale('en-US');
    setCreateBankAccountId('');
    await loadCreatePrefill({ orderId, type, clearCurrent: true });
  };

  const closeCreate = () => {
    ++createPrefillSequence.current;
    setCreateType(null);
    setCreateOrderId(null);
    setPrefill(null);
    setPrefillLoading(false);
    setCreateError(null);
    setCreateBusy(false);
  };

  const retryCreateValidation = () => {
    if (!createOrderId || !createType) return;
    void loadCreatePrefill({
      orderId: createOrderId,
      type: createType,
      templateVersionId: createTemplateVersionId || undefined,
      documentLocale: createTemplateVersionId ? createLocale : undefined,
    });
  };

  const createDocument = async () => {
    if (
      !createType ||
      !createOrderId ||
      !prefill ||
      prefillLoading ||
      prefill.resolvedTemplate.versionId !== createTemplateVersionId ||
      prefill.resolvedTemplate.locale !== createLocale
    ) {
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await commercialDocumentsApi.createFromOrder(createOrderId, {
        documentType: createType,
        locale: createLocale,
        templateVersionId: createTemplateVersionId || null,
        bankAccountId: createBankAccountId || null,
      });
      toast.success(t('common.saved'));
      closeCreate();
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

  const selectedCreateTemplate =
    prefill?.templateOptions.find((option) => option.versionId === createTemplateVersionId) ?? null;
  const selectedCreateBankAccount =
    prefill?.bankAccounts.find((account) => account.id === createBankAccountId) ?? null;
  const createPrefillCurrent = isCreateDocumentPrefillCurrent({
    resolvedTemplate: prefill?.resolvedTemplate ?? null,
    selectedTemplateVersionId: createTemplateVersionId,
    selectedLocale: createLocale,
    loading: prefillLoading,
  });

  const changeFilter = (key: OrderFilterKey, value: string) => {
    const next = { ...filters, [key]: value };
    setPage(1);
    setFilters(next);
    syncUrl(next);
  };

  const clearFilter = (key: OrderFilterKey) => {
    const next = { ...filters, [key]: '' };
    setPage(1);
    setFilters(next);
    syncUrl(next);
    if (key === 'q') setSearchInput('');
  };

  const clearAllFilters = () => {
    setPage(1);
    setFilters(EMPTY_ORDER_FILTERS);
    setSearchInput('');
    syncUrl(EMPTY_ORDER_FILTERS);
  };

  const submitSearch = () => {
    const next = { ...filters, q: searchInput.trim() };
    setPage(1);
    setFilters(next);
    syncUrl(next);
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
          canReadOrders ? (
            <Button variant="secondary" loading={loading} onClick={() => void load()}>
              {t('commercialDocuments.orders.refresh')}
            </Button>
          ) : undefined
        }
      />

      <OrderListView
        rows={rows}
        loading={loading}
        error={error}
        requestId={requestId}
        filters={filters}
        searchInput={searchInput}
        advancedOpen={advancedOpen}
        templates={templates}
        templateId={templateId}
        exportBusyId={exportBusyId}
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        totalPages={pagination.totalPages}
        canRead={canReadOrders}
        canCreateDocument={canCreateDocument}
        canExport={canReadOrders}
        canOpenCalculator={can('quotation.read') || can('quotation.calculate')}
        isMobile={viewport === 'mobile'}
        locale={locale}
        t={t}
        onSearchInputChange={setSearchInput}
        onSearchSubmit={submitSearch}
        onToggleAdvanced={() => setAdvancedOpen((current) => !current)}
        onChangeFilter={changeFilter}
        onClearFilter={clearFilter}
        onClearAll={clearAllFilters}
        onRefresh={() => void load()}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPage(1);
          setPageSize(size);
        }}
        onOpenDetail={(id) => void openDetail(id)}
        onCreateDocument={(type, orderId) => void openCreate(type, orderId)}
        onExport={(row) => void exportExcel(row)}
        onTemplateChange={setTemplateId}
        onOpenDocument={(id) => router.push(localeHref(locale, `/commercial-documents/${id}`))}
        onOpenCalculator={() => router.push(localeHref(locale, '/quotation-calculator'))}
      />

      <Drawer
        open={Boolean(detail) || detailLoading}
        title={detail?.orderNo ?? t('commercialDocuments.orderDetail.title')}
        size="xl"
        resizable
        maximizable
        labels={{
          maximize: t('commercialDocuments.orderDetail.maximize'),
          restore: t('commercialDocuments.orderDetail.restore'),
          resize: t('commercialDocuments.orderDetail.resize'),
        }}
        onClose={() => {
          detailSequence.current += 1;
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
              <div className="alert alert-warning">
                {t('commercialDocuments.orderEditor.issuedHint')}
              </div>
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
                  {[detail.buyer?.contactName, detail.buyer?.phone, detail.buyer?.email]
                    .filter((value) => Boolean(value && String(value).trim()))
                    .join(' · ') || t('commercialDocuments.orderEditor.notProvided')}
                </p>
                <h3>{t('commercialDocuments.orderDetail.consignee')}</h3>
                <pre className="pre-wrap">{formatAddress(detail.consignee, 'shipping')}</pre>
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
                          {item.packaging?.cartonLengthCm ?? '—'} ×{' '}
                          {item.packaging?.cartonWidthCm ?? '—'} ×{' '}
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
                                router.push(
                                  localeHref(locale, `/commercial-documents/${document.id}`),
                                )
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
            {pendingSync ? (
              <Button loading={editBusy} onClick={() => void retrySync()}>
                {syncPrompt
                  ? t('commercialDocuments.orderEditor.syncNow')
                  : t('commercialDocuments.orderEditor.retrySync')}
              </Button>
            ) : (
              <Button
                loading={editBusy}
                disabled={Boolean(conflictDetail)}
                onClick={() => void saveCorrection()}
              >
                {t('commercialDocuments.orderEditor.save')}
              </Button>
            )}
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
          {conflictDetail ? (
            <div className="alert alert-warning" role="alert">
              <strong>{t('commercialDocuments.orderEditor.conflictTitle')}</strong>
              <p>{t('commercialDocuments.orderEditor.conflictHint')}</p>
              {conflictChanges.length > 0 ? (
                <ul className="customer-change-list">
                  {conflictChanges.map((change) => (
                    <li key={change.field}>
                      <span>{t(change.labelKey)}</span>
                      <span className="mono">
                        {change.before || t('commercialDocuments.orderEditor.notProvided')} →{' '}
                        {change.after || t('commercialDocuments.orderEditor.notProvided')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{t('commercialDocuments.orderEditor.noChanges')}</p>
              )}
              <div className="button-row">
                <Button size="sm" variant="secondary" onClick={useServerVersion}>
                  {t('commercialDocuments.orderEditor.useServerVersion')}
                </Button>
                <Button size="sm" variant="ghost" onClick={keepLocalAndRefreshVersion}>
                  {t('commercialDocuments.orderEditor.keepLocal')}
                </Button>
              </div>
            </div>
          ) : null}
          {pendingSync && syncPrompt && !syncError ? (
            <div className="alert alert-warning" role="status">
              <strong>{t('commercialDocuments.orderEditor.syncPromptTitle')}</strong>
              <p>{t('commercialDocuments.orderEditor.syncConfirm')}</p>
              <div className="button-row">
                <Button size="sm" loading={editBusy} onClick={() => void retrySync()}>
                  {t('commercialDocuments.orderEditor.syncNow')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={editBusy}
                  onClick={() => {
                    setPendingSync(null);
                    setSyncPrompt(false);
                    setEditOpen(false);
                  }}
                >
                  {t('commercialDocuments.orderEditor.syncLater')}
                </Button>
              </div>
            </div>
          ) : null}
          {syncError ? (
            <div className="alert alert-error" role="alert">
              <strong>{t('commercialDocuments.orderEditor.syncFailed')}</strong>
              <p>{syncError}</p>
              <p className="muted">{t('commercialDocuments.orderEditor.syncFailedHint')}</p>
              <Button
                size="sm"
                variant="secondary"
                loading={editBusy}
                onClick={() => void retrySync()}
              >
                {t('commercialDocuments.orderEditor.retrySync')}
              </Button>
            </div>
          ) : null}
          <h3>{t('commercialDocuments.orderEditor.buyerSection')}</h3>
          <PartyFields
            form={buyerForm}
            setForm={setBuyerForm}
            t={t}
            addressTitle={t('commercialDocuments.orderDetail.billingAddress')}
          />
          <Checkbox
            id="billing-same-as-consignee"
            label={t('commercialDocuments.orderEditor.billingSameAsConsignee')}
            help={t('commercialDocuments.orderEditor.billingSameAsConsigneeHint')}
            checked={billingSameAsConsignee}
            onChange={(event) => {
              const checked = event.target.checked;
              setBillingSameAsConsignee(checked);
              if (!checked) return;
              setBuyerForm((current) => ({
                ...current,
                line1: consigneeForm.line1,
                line2: consigneeForm.line2,
                city: consigneeForm.city,
                state: consigneeForm.state,
                postalCode: consigneeForm.postalCode,
                addressCountryCode: consigneeForm.addressCountryCode,
              }));
            }}
          />
          <div className="row-between">
            <h3>{t('commercialDocuments.orderEditor.consigneeSection')}</h3>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setConsigneeForm({ ...buyerForm });
                setBillingSameAsConsignee(false);
              }}
            >
              {t('commercialDocuments.orderEditor.copyBuyer')}
            </Button>
          </div>
          <p className="field-help">{t('commercialDocuments.orderEditor.copyBuyerHint')}</p>
          <PartyFields
            form={consigneeForm}
            setForm={setConsigneeForm}
            t={t}
            addressTitle={t('commercialDocuments.orderDetail.shippingAddress')}
          />
          <h3>{t('commercialDocuments.orderEditor.referenceSection')}</h3>
          <div className="form-grid">
            <Field label={t('quotationCenter.buyerReference')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={referenceForm.buyerReference}
                  onChange={(event) =>
                    setReferenceForm((current) => ({
                      ...current,
                      buyerReference: event.target.value,
                    }))
                  }
                  maxLength={120}
                />
              )}
            </Field>
            <Field
              label={t('quotationCenter.contractNo')}
              help={t('commercialDocuments.orderEditor.contractNoReadOnly')}
            >
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={referenceForm.contractNo}
                  readOnly
                  disabled
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
                  options={[
                    'EXW',
                    'FCA',
                    'FAS',
                    'FOB',
                    'CFR',
                    'CIF',
                    'CPT',
                    'CIP',
                    'DAP',
                    'DPU',
                    'DDP',
                  ].map((code) => ({ value: code, label: code }))}
                  onChange={(event) =>
                    setReferenceForm((current) => ({
                      ...current,
                      incotermCode: event.target.value,
                    }))
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
                    setReferenceForm((current) => ({
                      ...current,
                      paymentTerms: event.target.value,
                    }))
                  }
                  maxLength={500}
                />
              )}
            </Field>
          </div>
          <h3>{t('commercialDocuments.orderEditor.changeSummary')}</h3>
          {customerChanges.length > 0 ? (
            <ul className="customer-change-list" aria-live="polite">
              {customerChanges.map((change) => (
                <li key={change.field}>
                  <span>{t(change.labelKey)}</span>
                  <span className="mono">
                    {change.before || t('commercialDocuments.orderEditor.notProvided')} →{' '}
                    {change.after || t('commercialDocuments.orderEditor.notProvided')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t('commercialDocuments.orderEditor.noChanges')}</p>
          )}
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
        onClose={closeCreate}
        footer={
          <>
            <Button variant="secondary" onClick={closeCreate} disabled={createBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={createBusy}
              disabled={
                !prefill ||
                !createPrefillCurrent ||
                prefillLoading ||
                prefill.bankAccountStatus === 'MISSING' ||
                (prefill.bankAccounts.length > 0 && !createBankAccountId)
              }
              onClick={() => void createDocument()}
            >
              {t('commercialDocuments.create.create')}
            </Button>
          </>
        }
      >
        {prefillLoading ? <p>{t('quotationCenter.loading')}</p> : null}
        {createError ? (
          <div className="alert alert-error stack-sm" role="alert">
            <span>{createError}</span>
            <Button variant="secondary" onClick={retryCreateValidation}>
              {t('commercialDocuments.create.retryValidation')}
            </Button>
          </div>
        ) : null}
        {prefill ? (
          <div className="stack-sm">
            <dl className="definition-list">
              <dt>{t('commercialDocuments.create.type')}</dt>
              <dd>{t(`commercialDocuments.types.${prefill.documentType}`)}</dd>
              <dt>{t('commercialDocuments.create.template')}</dt>
              <dd>
                {selectedCreateTemplate?.name ?? prefill.resolvedTemplate.name} v
                {selectedCreateTemplate?.version ?? prefill.resolvedTemplate.version} ·{' '}
                {commercialDocumentLocaleLabel(
                  selectedCreateTemplate?.locale ?? prefill.resolvedTemplate.locale,
                  t,
                )}
              </dd>
              <dt>{t('commercialDocuments.columns.currency')}</dt>
              <dd>{prefill.currency}</dd>
              <dt>{t('commercialDocuments.editor.fields.total')}</dt>
              <dd className="mono">{prefill.totals.totalAmount}</dd>
              {selectedCreateBankAccount ? (
                <>
                  <dt>{t('commercialDocuments.create.bankAccount')}</dt>
                  <dd>
                    {selectedCreateBankAccount.label} · {selectedCreateBankAccount.bankName}
                  </dd>
                </>
              ) : null}
            </dl>
            <Field label={t('commercialDocuments.create.template')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={createTemplateVersionId}
                  options={prefill.templateOptions.map((option) => ({
                    value: option.versionId,
                    label: `${option.name} v${option.version} · ${commercialDocumentLocaleLabel(option.locale, t)}${option.hasUnpublishedChanges ? ` · ${t('documentTemplates.pendingPublish')}` : ''}`,
                  }))}
                  onChange={(event) => {
                    const selected = prefill.templateOptions.find(
                      (option) => option.versionId === event.target.value,
                    );
                    if (!selected || !createOrderId || !createType) return;
                    setCreateTemplateVersionId(selected.versionId);
                    setCreateLocale(selected.locale);
                    void loadCreatePrefill({
                      orderId: createOrderId,
                      type: createType,
                      templateVersionId: selected.versionId,
                      documentLocale: selected.locale,
                    });
                  }}
                />
              )}
            </Field>
            {selectedCreateTemplate?.hasUnpublishedChanges ? (
              <p className="notice notice-warning" role="status">
                {t('commercialDocuments.create.templateDraftPending', {
                  version: selectedCreateTemplate.version,
                })}
              </p>
            ) : null}
            <Field
              label={t('commercialDocuments.create.locale')}
              help={t('commercialDocuments.create.localeFollowsTemplate')}
            >
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={createLocale}
                  disabled
                  options={[
                    { value: 'en-US', label: commercialDocumentLocaleLabel('en-US', t) },
                    { value: 'zh-CN', label: commercialDocumentLocaleLabel('zh-CN', t) },
                  ]}
                  onChange={() => undefined}
                />
              )}
            </Field>
            {prefill.bankAccounts.length > 0 ? (
              <Field
                label={t('commercialDocuments.create.bankAccount')}
                help={
                  createBankAccountId
                    ? undefined
                    : t('commercialDocuments.editor.selectBankAccountHint')
                }
              >
                {({ inputId, describedBy }) => (
                  <Select
                    inputId={inputId}
                    describedBy={describedBy}
                    value={createBankAccountId}
                    options={prefill.bankAccounts.map((account) => ({
                      value: account.id,
                      label: `${account.label} · ${account.bankName}${account.isDefault ? ' · ' + t('companyProfile.bank.default') : ''}`,
                    }))}
                    onChange={(event) => setCreateBankAccountId(event.target.value)}
                  />
                )}
              </Field>
            ) : (
              <div className="alert alert-warning" role="alert">
                {t('commercialDocuments.editor.noBankAccountForCurrency', {
                  currency: prefill.currency,
                })}
              </div>
            )}
            {prefillLoading ? (
              <div className="alert" role="status">
                {t('commercialDocuments.create.validationLoading')}
              </div>
            ) : createPrefillCurrent ? (
              <CommercialDocumentMissingFields
                report={prefill.missingReport}
                missingFields={prefill.missingFields}
                missingItemLines={prefill.missingItemLines}
                templateName={`${prefill.resolvedTemplate.name} v${prefill.resolvedTemplate.version}`}
                t={t}
              />
            ) : (
              <div className="alert alert-warning stack-sm" role="alert">
                <span>{t('commercialDocuments.create.validationStale')}</span>
                <Button variant="secondary" onClick={retryCreateValidation}>
                  {t('commercialDocuments.create.retryValidation')}
                </Button>
              </div>
            )}
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
  addressTitle,
}: {
  form: PartyForm;
  setForm: (updater: (current: PartyForm) => PartyForm) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  addressTitle: string;
}) {
  const update = (key: keyof PartyForm) => (event: ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const notProvided = t('commercialDocuments.orderEditor.notProvided');
  return (
    <div className="stack-sm">
      <h4>{t('commercialDocuments.orderEditor.partyDetails')}</h4>
      <div className="form-grid">
        <Field label={t('commercialDocuments.editor.fields.companyName')}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              value={form.companyName}
              onChange={update('companyName')}
              placeholder={notProvided}
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
              placeholder={notProvided}
              maxLength={160}
            />
          )}
        </Field>
        <Field
          label={t('commercialDocuments.editor.fields.phone')}
          help={t('commercialDocuments.orderEditor.phoneHint')}
        >
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              value={form.phone}
              onChange={update('phone')}
              placeholder="+14155552671"
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
              placeholder={notProvided}
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
              placeholder={notProvided}
              maxLength={60}
            />
          )}
        </Field>
        <Field label={t('commercialDocuments.editor.fields.countryCode')}>
          {({ inputId, describedBy }) => (
            <CountrySelect
              inputId={inputId}
              describedBy={describedBy}
              value={form.countryCode}
              onChange={(value) => setForm((current) => ({ ...current, countryCode: value }))}
              placeholder={t('countrySelect.placeholder')}
            />
          )}
        </Field>
      </div>
      <h4>{addressTitle}</h4>
      <div className="form-grid">
        <Field label={t('commercialDocuments.editor.fields.addressLine1')}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              value={form.line1}
              onChange={update('line1')}
              placeholder={notProvided}
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
              placeholder={notProvided}
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
              placeholder={notProvided}
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
              placeholder={notProvided}
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
              placeholder={notProvided}
              maxLength={40}
            />
          )}
        </Field>
        <Field label={t('commercialDocuments.editor.fields.addressCountryCode')}>
          {({ inputId, describedBy }) => (
            <CountrySelect
              inputId={inputId}
              describedBy={describedBy}
              value={form.addressCountryCode}
              onChange={(value) =>
                setForm((current) => ({ ...current, addressCountryCode: value }))
              }
              placeholder={t('countrySelect.placeholder')}
            />
          )}
        </Field>
      </div>
    </div>
  );
}
