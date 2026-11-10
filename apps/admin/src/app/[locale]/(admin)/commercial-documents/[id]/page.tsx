'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from '@b2b/ui';
import { isCommercialDocumentDownloadable } from '@b2b/contracts';
import { AdminApiError } from '../../../../../lib/admin-api';
import { commercialDocumentsApi } from '../../../../../lib/commercial-documents-api';
import { commercialDocumentLocaleLabel } from '../../../../../lib/commercial-document-labels';
import {
  isTemplateFieldVisible,
  isTemplateSectionVisible,
  visibleItemEditorColumns,
  visibleNotes,
  visiblePartyFields,
  visibleShippingFields,
  visibleTotalsFields,
  SHIPPING_FIELD_KEYS,
  TOTALS_FIELD_KEYS,
  type PartyEditorField,
  type ShippingEditorField,
  type TotalsEditorField,
} from '../../../../../lib/commercial-document-editor-config';
import { CommercialDocumentMissingFields } from '../../../../../components/commercial-document-missing-fields';
import type {
  CommercialDocumentDetail,
  CommercialDocumentItem,
  DocumentTemplateConfig,
} from '../../../../../lib/commercial-documents-api';
import { localeHref, translateError } from '../../../../../lib/i18n';
import { useBreadcrumb } from '../../../../../components/use-breadcrumb';
import { useSession } from '../../../../../components/session-provider';

interface PartyState {
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
  logoAssetId?: string;
  stampAssetId?: string;
}

interface ItemState {
  lineNo: number;
  productId: string | null;
  sku: string;
  description: string;
  hsCode: string;
  originCountryCode: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountAmount: string;
  cartons: string;
  unitsPerCarton: string;
  netWeightKg: string;
  grossWeightKg: string;
  cbm: string;
}

type EditableItemField =
  | 'sku'
  | 'description'
  | 'hsCode'
  | 'originCountryCode'
  | 'quantity'
  | 'unit'
  | 'unitPrice'
  | 'cartons'
  | 'netWeightKg'
  | 'grossWeightKg'
  | 'cbm';

const ITEM_COLUMN_INPUT_FIELDS: Partial<Record<string, EditableItemField>> = {
  'items.sku': 'sku',
  'items.description': 'description',
  'items.hsCode': 'hsCode',
  'items.originCountryCode': 'originCountryCode',
  'items.quantity': 'quantity',
  'items.unit': 'unit',
  'items.unitPrice': 'unitPrice',
  'items.cartons': 'cartons',
  'items.netWeightKg': 'netWeightKg',
  'items.grossWeightKg': 'grossWeightKg',
  'items.cbm': 'cbm',
};

const ITEM_COLUMN_LABEL_KEYS: Record<string, string> = {
  'items.lineNo': 'lineNo',
  'items.sku': 'sku',
  'items.description': 'description',
  'items.hsCode': 'hsCode',
  'items.originCountryCode': 'origin',
  'items.quantity': 'quantity',
  'items.unit': 'unit',
  'items.unitPrice': 'unitPrice',
  'items.cartons': 'cartons',
  'items.netWeightKg': 'netWeight',
  'items.grossWeightKg': 'grossWeight',
  'items.cbm': 'cbm',
  'items.amount': 'amount',
};

const SHIPPING_LABEL_KEYS: Record<ShippingEditorField, string> = {
  method: 'shippingMethod',
  portOfLoading: 'portOfLoading',
  portOfDischarge: 'portOfDischarge',
  route: 'route',
  transitTime: 'transitTime',
  cartonCount: 'cartonCount',
  netWeightKg: 'netWeightKg',
  grossWeightKg: 'grossWeightKg',
  cbm: 'cbm',
  marks: 'marks',
};

const TOTALS_LABEL_KEYS: Record<TotalsEditorField, string> = {
  discountAmount: 'discount',
  freightAmount: 'freight',
  insuranceAmount: 'insurance',
  otherCharges: 'otherCharges',
};

interface FormState {
  locale: string;
  issueDate: string;
  validUntil: string;
  seller: PartyState;
  buyer: PartyState;
  consignee: PartyState;
  notify: PartyState;
  notifyEnabled: boolean;
  trade: {
    contractNo: string;
    buyerReference: string;
    incotermCode: string;
    namedPlace: string;
    paymentTerms: string;
  };
  shipping: {
    method: string;
    portOfLoading: string;
    portOfDischarge: string;
    route: string;
    transitTime: string;
    cartonCount: string;
    netWeightKg: string;
    grossWeightKg: string;
    cbm: string;
    marks: string;
  };
  payment: {
    accountHolder: string;
    bankName: string;
    bankAddress: string;
    accountNumber: string;
    swiftCode: string;
    wireRoutingNumber: string;
    achRoutingNumber: string;
  };
  declaration: {
    countryOfOrigin: string;
    text: string;
    authenticityText: string;
  };
  signature: { sellerName: string; sellerTitle: string };
  notes: string;
  discountAmount: string;
  freightAmount: string;
  insuranceAmount: string;
  otherCharges: string;
}

const emptyParty: PartyState = {
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
  logoAssetId: '',
  stampAssetId: '',
};

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function maskBankAccount(value: string | null | undefined): string {
  const normalized = text(value).replace(/\s+/g, '');
  return normalized ? `****${normalized.slice(-4)}` : '—';
}

function partyFromSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
  addressKey: 'address' | 'billingAddress' | 'shippingAddress',
): PartyState {
  if (!snapshot) return { ...emptyParty };
  const address =
    (snapshot[addressKey] as Record<string, unknown> | null | undefined) ??
    (snapshot.address as Record<string, unknown> | null | undefined) ??
    null;
  return {
    companyName: text(snapshot.companyName),
    contactName: text(snapshot.contactName),
    phone: text(snapshot.phone),
    email: text(snapshot.email),
    taxId: text(snapshot.taxId),
    line1: text(address?.line1),
    line2: text(address?.line2),
    city: text(address?.city),
    state: text(address?.state),
    postalCode: text(address?.postalCode),
    countryCode: text(address?.countryCode ?? snapshot.countryCode),
    logoAssetId: text(snapshot.logoAssetId),
    stampAssetId: text(snapshot.stampAssetId),
  };
}

function partySnapshot(
  form: PartyState,
  addressKey: 'address' | 'billingAddress' | 'shippingAddress',
  countryCode: string,
): Record<string, unknown> {
  const address = {
    companyName: form.companyName.trim() || null,
    recipient: form.contactName.trim() || null,
    line1: form.line1.trim() || null,
    line2: form.line2.trim() || null,
    city: form.city.trim() || null,
    state: form.state.trim() || null,
    postalCode: form.postalCode.trim() || null,
    countryCode: form.countryCode.trim().toUpperCase() || countryCode || null,
  };
  return {
    schemaVersion: 1,
    companyName: form.companyName.trim() || null,
    contactName: form.contactName.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    taxId: form.taxId.trim() || null,
    countryCode: form.countryCode.trim().toUpperCase() || countryCode || null,
    [addressKey]: address,
  };
}

function itemFromDoc(item: CommercialDocumentItem): ItemState {
  return {
    lineNo: item.lineNo,
    productId: item.productId ?? null,
    sku: item.sku,
    description: item.description ?? '',
    hsCode: item.hsCode ?? '',
    originCountryCode: item.originCountryCode ?? '',
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
    discountAmount: item.discountAmount,
    cartons: item.cartons === null || item.cartons === undefined ? '' : String(item.cartons),
    unitsPerCarton:
      item.unitsPerCarton === null || item.unitsPerCarton === undefined
        ? ''
        : String(item.unitsPerCarton),
    netWeightKg: item.netWeightKg ?? '',
    grossWeightKg: item.grossWeightKg ?? '',
    cbm: item.cbm ?? '',
  };
}

function blankItem(lineNo: number): ItemState {
  return {
    lineNo,
    productId: null,
    sku: '',
    description: '',
    hsCode: '',
    originCountryCode: '',
    quantity: '1',
    unit: 'pcs',
    unitPrice: '0',
    discountAmount: '0',
    cartons: '',
    unitsPerCarton: '',
    netWeightKg: '',
    grossWeightKg: '',
    cbm: '',
  };
}

function buildForm(detail: CommercialDocumentDetail): FormState {
  const trade = detail.trade ?? {};
  const shipping = detail.shipping ?? {};
  const payment = detail.payment ?? {};
  const declaration = detail.declaration ?? {};
  const signature = detail.signature ?? {};
  return {
    locale: detail.locale === 'zh-CN' ? 'zh-CN' : 'en-US',
    issueDate: detail.issueDate ?? '',
    validUntil: detail.validUntil ?? '',
    seller: partyFromSnapshot(detail.seller, 'address'),
    buyer: partyFromSnapshot(detail.buyer, 'billingAddress'),
    consignee: partyFromSnapshot(detail.consignee, 'shippingAddress'),
    notify: partyFromSnapshot(detail.notifyParty, 'address'),
    notifyEnabled: Boolean(detail.notifyParty),
    trade: {
      contractNo: text(trade.contractNo ?? detail.trade?.contractNo),
      buyerReference: text(trade.buyerReference ?? detail.buyerReference),
      incotermCode: text(trade.incotermCode),
      namedPlace: text(trade.namedPlace),
      paymentTerms: text(trade.paymentTerms),
    },
    shipping: {
      method: text(shipping.method),
      portOfLoading: text(shipping.portOfLoading),
      portOfDischarge: text(shipping.portOfDischarge),
      route: text(shipping.route),
      transitTime: text(shipping.transitTime),
      cartonCount: text(shipping.cartonCount),
      netWeightKg: text(shipping.netWeightKg),
      grossWeightKg: text(shipping.grossWeightKg),
      cbm: text(shipping.cbm),
      marks: text(shipping.marks),
    },
    payment: {
      accountHolder: text(payment.accountHolder),
      bankName: text(payment.bankName),
      bankAddress: text(payment.bankAddress),
      accountNumber: text(payment.accountNumber),
      swiftCode: text(payment.swiftCode),
      wireRoutingNumber: text(payment.wireRoutingNumber),
      achRoutingNumber: text(payment.achRoutingNumber),
    },
    declaration: {
      countryOfOrigin: text(declaration.countryOfOrigin),
      text: text(declaration.text),
      authenticityText: text(declaration.authenticityText),
    },
    signature: {
      sellerName: text(signature.sellerName),
      sellerTitle: text(signature.sellerTitle),
    },
    notes: detail.notes ?? '',
    discountAmount: detail.totals.discountAmount,
    freightAmount: detail.totals.freightAmount,
    insuranceAmount: detail.totals.insuranceAmount,
    otherCharges: detail.totals.otherCharges,
  };
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'ISSUED':
      return 'success';
    case 'REVIEW':
      return 'warning';
    case 'CANCELLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export default function CommercialDocumentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { t, can, locale } = useSession();
  const breadcrumb = useBreadcrumb();
  const toast = useToast();
  const router = useRouter();

  const [detail, setDetail] = useState<CommercialDocumentDetail | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [items, setItems] = useState<ItemState[]>([]);
  const [templateVersionId, setTemplateVersionId] = useState('');
  const [templateOptions, setTemplateOptions] = useState<
    Awaited<ReturnType<typeof commercialDocumentsApi.activeTemplateOptions>>
  >([]);
  const [profiles, setProfiles] = useState<
    Awaited<ReturnType<typeof commercialDocumentsApi.companyProfileOptions>>
  >([]);
  const [bankSelection, setBankSelection] = useState('');
  const [bankSelectionDirty, setBankSelectionDirty] = useState(false);
  const [companyProfileId, setCompanyProfileId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'issue' | 'cancel' | 'delete' | null>(null);

  const editable = detail ? detail.status === 'DRAFT' || detail.status === 'REVIEW' : false;
  const canUpdate = can('commercial_document.update');
  const canPreview = can('commercial_document.preview');
  const canIssue = can('commercial_document.issue');
  const canDownload = can('commercial_document.download');
  const canRevise = can('commercial_document.revision.create');
  const canCancel = can('commercial_document.cancel');
  const canDelete = can('commercial_document.delete');

  const applyDetail = useCallback((next: CommercialDocumentDetail) => {
    setDetail(next);
    setForm(buildForm(next));
    setItems(next.items.map(itemFromDoc));
    setTemplateVersionId(next.template.versionId ?? '');
    setCompanyProfileId(next.companyProfileId ?? '');
    setBankSelection(next.bankAccountId ?? '');
    setBankSelectionDirty(false);
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [document, options, companyProfiles] = await Promise.all([
        commercialDocumentsApi.document(id),
        commercialDocumentsApi.activeTemplateOptions().catch(() => []),
        commercialDocumentsApi.companyProfileOptions().catch(() => []),
      ]);
      applyDetail(document);
      setTemplateOptions(options);
      setProfiles(companyProfiles);
      const profile =
        companyProfiles.find((candidate) => candidate.id === document.companyProfileId) ??
        companyProfiles.find((candidate) => candidate.isDefault) ??
        companyProfiles[0] ??
        null;
      const availableBanks =
        profile?.bankAccounts.filter((account) => account.currencyCode === document.currency) ?? [];
      const initialBank = availableBanks.find((account) => account.id === document.bankAccountId);
      setCompanyProfileId(profile?.id ?? '');
      setBankSelection(initialBank?.id ?? '');
      setBankSelectionDirty(false);
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
      setRequestId(cause instanceof AdminApiError ? (cause.requestId ?? null) : null);
    } finally {
      setLoading(false);
    }
  }, [applyDetail, id, locale, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // A render request is asynchronous. Keep the visible status current without
  // replacing the editor form, which may have changed while the Worker runs.
  useEffect(() => {
    const job = detail?.renderJob;
    if (!job || (job.status !== 'QUEUED' && job.status !== 'PROCESSING')) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await commercialDocumentsApi.document(id);
        if (cancelled) return;
        setDetail((current) =>
          current
            ? {
                ...current,
                renderJob: next.renderJob,
                pdf: next.pdf,
                updatedAt: next.updatedAt,
              }
            : current,
        );
        if (next.renderJob?.status === 'QUEUED' || next.renderJob?.status === 'PROCESSING') {
          timer = setTimeout(() => void poll(), 1_500);
        }
      } catch {
        // A transient refresh failure must not discard editor state. The
        // manual Reload action remains available for recovery.
      }
    };
    timer = setTimeout(() => void poll(), 1_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [detail?.renderJob?.id, detail?.renderJob?.status, id]);

  const updateForm = (updater: (current: FormState) => FormState) => {
    setForm((current) => (current ? updater(current) : current));
    setDirty(true);
  };

  const updateItem = (index: number, key: keyof ItemState, value: string) => {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)),
    );
    setDirty(true);
  };

  const payload = useMemo(() => {
    if (!detail || !form) return null;
    return {
      version: detail.version,
      locale: form.locale,
      issueDate: form.issueDate || null,
      validUntil: form.validUntil || null,
      templateVersionId: templateVersionId || null,
      seller: {
        ...partySnapshot(form.seller, 'address', form.seller.countryCode),
        logoAssetId: form.seller.logoAssetId || null,
        stampAssetId: form.seller.stampAssetId || null,
      },
      buyer: partySnapshot(form.buyer, 'billingAddress', form.buyer.countryCode),
      consignee:
        form.consignee.companyName || form.consignee.line1
          ? partySnapshot(form.consignee, 'shippingAddress', form.consignee.countryCode)
          : null,
      notifyParty:
        form.notifyEnabled && (form.notify.companyName || form.notify.line1)
          ? partySnapshot(form.notify, 'address', form.notify.countryCode)
          : null,
      trade: {
        incotermCode: form.trade.incotermCode || null,
        namedPlace: form.trade.namedPlace,
        paymentTerms: form.trade.paymentTerms,
        contractNo: form.trade.contractNo,
        buyerReference: form.trade.buyerReference,
      },
      shipping: {
        method: form.shipping.method,
        portOfLoading: form.shipping.portOfLoading,
        portOfDischarge: form.shipping.portOfDischarge,
        route: form.shipping.route,
        transitTime: form.shipping.transitTime,
        cartonCount: form.shipping.cartonCount ? Number(form.shipping.cartonCount) : null,
        netWeightKg: form.shipping.netWeightKg || null,
        grossWeightKg: form.shipping.grossWeightKg || null,
        cbm: form.shipping.cbm || null,
        marks: form.shipping.marks,
      },
      companyProfileId: companyProfileId || null,
      ...(bankSelectionDirty ? { bankAccountId: bankSelection || null } : {}),
      declaration: {
        ...form.declaration,
        countryOfOrigin: form.declaration.countryOfOrigin || null,
      },
      signature: {
        sellerName: form.signature.sellerName,
        sellerTitle: form.signature.sellerTitle,
        stampAssetId:
          form.seller.stampAssetId ||
          (detail.signature as Record<string, unknown> | null)?.stampAssetId ||
          (detail.seller as Record<string, unknown>).stampAssetId ||
          null,
      },
      notes: form.notes || null,
      discountAmount: form.discountAmount,
      freightAmount: form.freightAmount,
      insuranceAmount: form.insuranceAmount,
      otherCharges: form.otherCharges,
      items: items.map((item, index) => ({
        lineNo: index + 1,
        productId: item.productId,
        sku: item.sku,
        description: item.description || null,
        hsCode: item.hsCode,
        originCountryCode: item.originCountryCode || null,
        quantity: item.quantity,
        unit: item.unit || 'pcs',
        unitPrice: item.unitPrice,
        discountAmount: item.discountAmount || '0',
        currency: detail.currency,
        cartons: item.cartons ? Number(item.cartons) : null,
        unitsPerCarton: item.unitsPerCarton ? Number(item.unitsPerCarton) : null,
        netWeightKg: item.netWeightKg || null,
        grossWeightKg: item.grossWeightKg || null,
        cbm: item.cbm || null,
      })),
    };
  }, [bankSelection, bankSelectionDirty, companyProfileId, detail, form, items, templateVersionId]);

  const persist = async (): Promise<CommercialDocumentDetail | null> => {
    if (!detail || !payload || !editable) return detail;
    const saved = await commercialDocumentsApi.updateDocument(detail.id, payload);
    applyDetail(saved);
    return saved;
  };

  const saveDraft = async () => {
    if (!editable) return;
    setBusy(true);
    setError(null);
    try {
      await persist();
      toast.success(t('commercialDocuments.editor.saved'));
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async () => {
    if (!detail) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      if (editable && dirty) await persist();
      const preview = await commercialDocumentsApi.previewDocument(detail.id);
      setPreviewHtml(preview.html);
    } catch (cause) {
      setPreviewError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const doIssue = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = editable && dirty ? await persist() : detail;
      if (!saved) return;
      const issued = await commercialDocumentsApi.issueDocument(saved.id, saved.version);
      applyDetail(issued);
      setConfirmAction(null);
      toast.success(t('commercialDocuments.editor.issued'));
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  const doRender = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      if (editable && dirty) await persist();
      const job = await commercialDocumentsApi.renderDocument(detail.id);
      setDetail((current) => (current ? { ...current, renderJob: job } : current));
      toast.success(t('commercialDocuments.editor.rendered'));
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  const doDownload = async () => {
    if (!detail) return;
    try {
      const file = await commercialDocumentsApi.downloadDocument(
        detail.id,
        `${detail.documentNo}-R${detail.revisionNo}.pdf`,
      );
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    }
  };

  const doRevise = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const next = await commercialDocumentsApi.reviseDocument(detail.id);
      toast.success(t('commercialDocuments.editor.revised'));
      router.push(localeHref(locale, `/commercial-documents/${next.id}`));
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const next = await commercialDocumentsApi.cancelDocument(detail.id);
      applyDetail(next);
      setConfirmAction(null);
      toast.success(t('commercialDocuments.editor.cancelled'));
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await commercialDocumentsApi.deleteDocument(detail.id);
      setConfirmAction(null);
      toast.success(t('commercialDocuments.editor.deleted'));
      router.push(localeHref(locale, '/commercial-documents'));
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  const missingLabels = useMemo(() => (detail ? detail.missingFieldLabels : []), [detail]);
  const missingItemLines = useMemo(() => (detail ? detail.missingItemLines : []), [detail]);
  const templateSelectionChanged = Boolean(
    detail && templateVersionId && templateVersionId !== detail.template.versionId,
  );

  if (loading) {
    return (
      <div className="stack">
        <PageHeader breadcrumb={breadcrumb} title={t('commercialDocuments.editor.title')} />
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="stack">
        <PageHeader breadcrumb={breadcrumb} title={t('commercialDocuments.editor.title')} />
        <div className="alert alert-error" role="alert">
          {error}
          {requestId ? <span className="mono"> · {requestId}</span> : null}
        </div>
      </div>
    );
  }

  if (!detail || !form) return null;

  const selectedTemplateOption =
    templateOptions.find((option) => option.versionId === templateVersionId) ?? null;
  const config: DocumentTemplateConfig =
    (templateSelectionChanged ? selectedTemplateOption?.config : null) ?? detail.config;
  const selectedCompany = profiles.find((profile) => profile.id === companyProfileId) ?? null;
  const availableBankAccounts =
    selectedCompany?.bankAccounts.filter((account) => account.currencyCode === detail.currency) ??
    [];
  const selectedBankAccount =
    availableBankAccounts.find((account) => account.id === bankSelection) ?? null;
  const existingPayment = detail.payment ?? null;
  const sellerFields = visiblePartyFields(config, 'seller');
  const buyerFields = visiblePartyFields(config, 'buyer');
  const consigneeFields = visiblePartyFields(config, 'consignee');
  const notifyFields = visiblePartyFields(config, 'notifyParty');
  const shippingFields = visibleShippingFields(config);
  const totalsFields = visibleTotalsFields(config);
  const itemColumns = visibleItemEditorColumns(config);
  const renderErrorCode =
    detail.renderJob?.status === 'FAILED'
      ? (detail.renderJob.errorCode ?? 'COMMERCIAL_DOCUMENT_RENDER_FAILED')
      : null;
  const showField = (section: Parameters<typeof isTemplateFieldVisible>[1], key: string) =>
    isTemplateFieldVisible(config, section, key);
  const showTradeSection =
    isTemplateSectionVisible(config, 'trade') &&
    (['trade.incoterm', 'trade.namedPlace', 'trade.paymentTerms'].some((key) =>
      showField('trade', key),
    ) ||
      showField('invoice', 'order.contractNo') ||
      showField('invoice', 'order.buyerReference'));
  const showInvoiceValues = ['document.number', 'document.issueDate', 'document.validUntil'].some(
    (key) => showField('invoice', key),
  );
  const showOrderReferences =
    showField('invoice', 'order.number') ||
    showField('invoice', 'order.date') ||
    showField('invoice', 'order.contractNo') ||
    showField('invoice', 'order.buyerReference');
  const showPaymentSection =
    isTemplateSectionVisible(config, 'payment') &&
    [
      'payment.accountHolder',
      'payment.bankName',
      'payment.bankAddress',
      'payment.accountNumber',
      'payment.swift',
      'payment.wireRoutingNumber',
      'payment.achRoutingNumber',
    ].some((key) => showField('payment', key));
  const showTotalsSection =
    isTemplateSectionVisible(config, 'totals') &&
    (totalsFields.size > 0 ||
      showField('totals', 'totals.subtotal') ||
      showField('totals', 'totals.grandTotal'));
  const showSignatureFields = showField('signature', 'signature.seller');
  const showNotes = visibleNotes(config);
  const showDeclarationSection =
    showField('declaration', 'declaration.countryOfOrigin') ||
    showField('declaration', 'declaration.text') ||
    showField('declaration', 'declaration.authenticity') ||
    showSignatureFields ||
    showNotes;

  const changeSellerCompany = (nextId: string) => {
    const profile = profiles.find((candidate) => candidate.id === nextId) ?? null;
    setCompanyProfileId(nextId);
    setBankSelection('');
    setBankSelectionDirty(true);
    if (!profile) return;
    updateForm((current) => ({
      ...current,
      seller: {
        ...current.seller,
        companyName: profile.companyName,
        contactName: profile.contactName ?? '',
        phone: profile.phone ?? '',
        email: profile.email ?? '',
        taxId: profile.taxId ?? '',
        line1: String(profile.address?.line1 ?? ''),
        line2: String(profile.address?.line2 ?? ''),
        city: String(profile.address?.city ?? ''),
        state: String(profile.address?.state ?? ''),
        postalCode: String(profile.address?.postalCode ?? ''),
        countryCode: String(profile.address?.countryCode ?? ''),
        logoAssetId: profile.logoAssetId ?? '',
        stampAssetId: profile.stampAssetId ?? '',
      },
    }));
  };

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={`${detail.documentNo} · R${detail.revisionNo}`}
        description={`${t(`commercialDocuments.types.${detail.type}`)} · ${detail.orderNo ?? '—'} · ${detail.currency}`}
        actions={
          <div className="row-actions">
            <Badge tone={statusTone(detail.status)}>
              {t(`commercialDocuments.statuses.${detail.status}`)}
            </Badge>
            <Button
              variant="secondary"
              onClick={() => router.push(localeHref(locale, '/commercial-documents'))}
            >
              {t('commercialDocuments.editor.back')}
            </Button>
            <Button variant="secondary" loading={loading} onClick={() => void load()}>
              {t('commercialDocuments.editor.refresh')}
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {!editable ? (
        <div className="alert alert-warning">{t('commercialDocuments.editor.frozen')}</div>
      ) : null}
      {dirty && editable ? (
        <div className="alert alert-warning">{t('commercialDocuments.editor.unsaved')}</div>
      ) : null}
      {templateSelectionChanged ? (
        <div className="alert alert-warning" role="status">
          {t('commercialDocuments.editor.templateValidationPending')}
        </div>
      ) : (
        <CommercialDocumentMissingFields
          report={detail.missingReport}
          missingFields={missingLabels.map((field) => field.key)}
          missingItemLines={missingItemLines}
          templateName={
            detail.template.name ? `${detail.template.name} v${detail.template.version ?? 1}` : null
          }
          t={t}
        />
      )}

      <div className="row-actions">
        {editable && canUpdate ? (
          <Button loading={busy} onClick={() => void saveDraft()}>
            {t('commercialDocuments.editor.save')}
          </Button>
        ) : null}
        {canPreview ? (
          <Button variant="secondary" loading={previewLoading} onClick={() => void doPreview()}>
            {t('commercialDocuments.editor.preview')}
          </Button>
        ) : null}
        {editable && canIssue ? (
          <Button onClick={() => setConfirmAction('issue')}>
            {t('commercialDocuments.editor.issue')}
          </Button>
        ) : null}
        {canPreview ? (
          <Button variant="secondary" loading={busy} onClick={() => void doRender()}>
            {t(
              detail.renderJob?.status === 'FAILED'
                ? 'commercialDocuments.actions.retryRender'
                : 'commercialDocuments.editor.render',
            )}
          </Button>
        ) : null}
        {canDownload ? (
          <Button
            variant="secondary"
            disabled={
              !detail.pdf.available || !isCommercialDocumentDownloadable(detail.status)
            }
            onClick={() => void doDownload()}
          >
            {t('commercialDocuments.editor.download')}
          </Button>
        ) : null}
        {detail.status === 'ISSUED' && canRevise ? (
          <Button variant="secondary" loading={busy} onClick={() => void doRevise()}>
            {t('commercialDocuments.editor.revision')}
          </Button>
        ) : null}
        {detail.status !== 'CANCELLED' && detail.status !== 'SUPERSEDED' && canCancel ? (
          <Button variant="danger" onClick={() => setConfirmAction('cancel')}>
            {t('commercialDocuments.editor.cancel')}
          </Button>
        ) : null}
        {detail.status === 'DRAFT' && canDelete ? (
          <Button variant="danger" onClick={() => setConfirmAction('delete')}>
            {t('commercialDocuments.editor.delete')}
          </Button>
        ) : null}
      </div>

      <div className="document-workbench">
        <div className="stack">
          <section className="panel stack-sm document-section">
            <h2>{t('commercialDocuments.editor.sections.document')}</h2>
            <p className="field-help">{t('commercialDocuments.editor.templateFieldsHint')}</p>
            <div className="form-grid">
              <div>
                <SelectField
                  label={t('commercialDocuments.editor.fields.template')}
                  value={templateVersionId}
                  options={(() => {
                    const options = new Map<string, string>();
                    if (detail.template.versionId) {
                      options.set(
                        detail.template.versionId,
                        `${detail.template.name ?? t('commercialDocuments.editor.fields.template')} v${detail.template.version ?? 1} · ${commercialDocumentLocaleLabel(form.locale, t)}`,
                      );
                    }
                    for (const option of templateOptions.filter(
                      (candidate) => candidate.documentType === detail.type,
                    )) {
                      options.set(
                        option.versionId,
                        `${option.name} v${option.version} · ${commercialDocumentLocaleLabel(option.locale, t)}${option.hasUnpublishedChanges ? ` · ${t('documentTemplates.pendingPublish')}` : ''}`,
                      );
                    }
                    return [...options].map(([value, label]) => ({ value, label }));
                  })()}
                  disabled={!editable}
                  onChange={(value) => {
                    setTemplateVersionId(value);
                    const option = templateOptions.find(
                      (candidate) => candidate.versionId === value,
                    );
                    const nextLocale =
                      value === detail.template.versionId
                        ? detail.locale
                        : (option?.locale ?? form.locale);
                    updateForm((current) => ({ ...current, locale: nextLocale }));
                    setDirty(true);
                  }}
                />
                {selectedTemplateOption?.hasUnpublishedChanges ? (
                  <p className="notice notice-warning" role="status">
                    {t('commercialDocuments.editor.templateDraftPending', {
                      version: selectedTemplateOption.version,
                    })}
                  </p>
                ) : null}
              </div>
              <div>
                <SelectField
                  label={t('commercialDocuments.editor.fields.locale')}
                  value={form.locale}
                  options={[
                    { value: 'en-US', label: commercialDocumentLocaleLabel('en-US', t) },
                    { value: 'zh-CN', label: commercialDocumentLocaleLabel('zh-CN', t) },
                  ]}
                  disabled
                  onChange={() => undefined}
                />
                <p className="muted">{t('commercialDocuments.editor.localeFollowsTemplate')}</p>
              </div>
              {showInvoiceValues && showField('invoice', 'document.number') ? (
                <TextField
                  label={t('commercialDocuments.editor.fields.documentNo')}
                  value={detail.documentNo}
                  disabled
                  onChange={() => undefined}
                />
              ) : null}
              {showInvoiceValues && showField('invoice', 'document.issueDate') ? (
                <TextField
                  label={t('commercialDocuments.editor.fields.issueDate')}
                  type="date"
                  value={form.issueDate}
                  disabled={!editable}
                  onChange={(value) => updateForm((current) => ({ ...current, issueDate: value }))}
                />
              ) : null}
              {showInvoiceValues && showField('invoice', 'document.validUntil') ? (
                <TextField
                  label={t('commercialDocuments.editor.fields.validUntil')}
                  type="date"
                  value={form.validUntil}
                  disabled={!editable}
                  onChange={(value) => updateForm((current) => ({ ...current, validUntil: value }))}
                />
              ) : null}
              {showField('trade', 'trade.currency') ? (
                <TextField
                  label={t('commercialDocuments.editor.fields.currency')}
                  value={detail.currency}
                  disabled
                  onChange={() => undefined}
                />
              ) : null}
              {showOrderReferences && showField('invoice', 'order.number') ? (
                <TextField
                  label={t('commercialDocuments.orderDetail.orderNo')}
                  value={detail.orderNo ?? '—'}
                  disabled
                  onChange={() => undefined}
                />
              ) : null}
              {showOrderReferences && showField('invoice', 'order.date') ? (
                <TextField
                  label={t('commercialDocuments.orderDetail.orderDate')}
                  type="date"
                  value={detail.orderDate ?? ''}
                  disabled
                  onChange={() => undefined}
                />
              ) : null}
            </div>
          </section>

          {sellerFields.size > 0 ? (
            <section className="panel stack-sm document-section">
              <h2>{t('commercialDocuments.editor.sections.seller')}</h2>
              <PartyEditor
                form={form.seller}
                visibleFields={sellerFields}
                disabled={!editable}
                onChange={(next) => updateForm((current) => ({ ...current, seller: next }))}
                t={t}
              />
            </section>
          ) : null}

          {buyerFields.size > 0 ? (
            <section className="panel stack-sm document-section">
              <h2>{t('commercialDocuments.editor.sections.buyer')}</h2>
              <PartyEditor
                form={form.buyer}
                visibleFields={buyerFields}
                disabled={!editable}
                onChange={(next) => updateForm((current) => ({ ...current, buyer: next }))}
                t={t}
              />
            </section>
          ) : null}

          {consigneeFields.size > 0 ? (
            <section className="panel stack-sm document-section">
              <h2>{t('commercialDocuments.editor.sections.consignee')}</h2>
              <PartyEditor
                form={form.consignee}
                visibleFields={consigneeFields}
                disabled={!editable}
                onChange={(next) => updateForm((current) => ({ ...current, consignee: next }))}
                t={t}
              />
            </section>
          ) : null}

          {notifyFields.size > 0 ? (
            <section className="panel stack-sm document-section">
              <div className="row-between">
                <h2>{t('commercialDocuments.editor.sections.notifyParty')}</h2>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.notifyEnabled}
                    disabled={!editable}
                    onChange={(event) =>
                      updateForm((current) => ({ ...current, notifyEnabled: event.target.checked }))
                    }
                  />
                  <span>{t('common.yes')}</span>
                </label>
              </div>
              {form.notifyEnabled ? (
                <PartyEditor
                  form={form.notify}
                  visibleFields={notifyFields}
                  disabled={!editable}
                  onChange={(next) => updateForm((current) => ({ ...current, notify: next }))}
                  t={t}
                />
              ) : null}
            </section>
          ) : null}

          {showTradeSection ? (
            <section className="panel stack-sm document-section">
              <h2>{t('commercialDocuments.editor.sections.trade')}</h2>
              <div className="form-grid">
                {showField('trade', 'trade.incoterm') ? (
                  <TextField
                    label={t('commercialDocuments.editor.fields.incoterm')}
                    value={form.trade.incotermCode}
                    disabled={!editable}
                    onChange={(value) =>
                      updateForm((current) => ({
                        ...current,
                        trade: { ...current.trade, incotermCode: value },
                      }))
                    }
                  />
                ) : null}
                {showField('trade', 'trade.namedPlace') ? (
                  <TextField
                    label={t('commercialDocuments.editor.fields.namedPlace')}
                    value={form.trade.namedPlace}
                    disabled={!editable}
                    onChange={(value) =>
                      updateForm((current) => ({
                        ...current,
                        trade: { ...current.trade, namedPlace: value },
                      }))
                    }
                  />
                ) : null}
                {showField('trade', 'trade.paymentTerms') ? (
                  <TextField
                    label={t('commercialDocuments.editor.fields.paymentTerms')}
                    value={form.trade.paymentTerms}
                    disabled={!editable}
                    onChange={(value) =>
                      updateForm((current) => ({
                        ...current,
                        trade: { ...current.trade, paymentTerms: value },
                      }))
                    }
                  />
                ) : null}
                {showField('invoice', 'order.buyerReference') ? (
                  <TextField
                    label={t('commercialDocuments.orderDetail.buyerReference')}
                    value={form.trade.buyerReference}
                    disabled={!editable}
                    onChange={(value) =>
                      updateForm((current) => ({
                        ...current,
                        trade: { ...current.trade, buyerReference: value },
                      }))
                    }
                  />
                ) : null}
                {showField('invoice', 'order.contractNo') ? (
                  <TextField
                    label={t('commercialDocuments.orderDetail.contractNo')}
                    value={form.trade.contractNo}
                    disabled={!editable}
                    onChange={(value) =>
                      updateForm((current) => ({
                        ...current,
                        trade: { ...current.trade, contractNo: value },
                      }))
                    }
                  />
                ) : null}
                {showField('trade', 'trade.exchangeRate') ? (
                  <TextField
                    label={t('commercialDocuments.editor.fields.exchangeRate')}
                    value={String(
                      (detail.trade as Record<string, unknown> | null)?.exchangeRateText ?? '—',
                    )}
                    disabled
                    onChange={() => undefined}
                  />
                ) : null}
              </div>
            </section>
          ) : null}

          {shippingFields.size > 0 ? (
            <section className="panel stack-sm document-section">
              <h2>{t('commercialDocuments.editor.sections.shipping')}</h2>
              <div className="form-grid">
                {(Object.entries(SHIPPING_FIELD_KEYS) as Array<[ShippingEditorField, string]>)
                  .filter(([field]) => shippingFields.has(field))
                  .map(([field]) => (
                    <TextField
                      key={field}
                      label={t(`commercialDocuments.editor.fields.${SHIPPING_LABEL_KEYS[field]}`)}
                      value={form.shipping[field]}
                      disabled={!editable}
                      onChange={(value) =>
                        updateForm((current) => ({
                          ...current,
                          shipping: { ...current.shipping, [field]: value },
                        }))
                      }
                    />
                  ))}
              </div>
            </section>
          ) : null}

          {showPaymentSection ? (
            <section className="panel stack-sm document-section">
              <h2>{t('commercialDocuments.editor.sections.payment')}</h2>
              <div className="form-grid">
                <Field label={t('commercialDocuments.editor.sellerCompany')}>
                  {({ inputId, describedBy }) => (
                    <Select
                      inputId={inputId}
                      describedBy={describedBy}
                      value={companyProfileId}
                      disabled={!editable || profiles.length === 0}
                      placeholder={t('commercialDocuments.editor.selectCompany')}
                      options={profiles.map((profile) => ({
                        value: profile.id,
                        label: `${profile.companyName}${profile.isDefault ? ' · ' + t('companyProfile.default') : ''}`,
                      }))}
                      onChange={(event) => changeSellerCompany(event.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label={t('commercialDocuments.editor.bankAccount')}
                  help={
                    availableBankAccounts.length === 0
                      ? t('commercialDocuments.editor.noBankAccountForCurrency', {
                          currency: detail.currency,
                        })
                      : !bankSelection
                        ? t('commercialDocuments.editor.selectBankAccountHint')
                        : undefined
                  }
                >
                  {({ inputId, describedBy }) => (
                    <Select
                      inputId={inputId}
                      describedBy={describedBy}
                      value={bankSelection}
                      disabled={!editable || availableBankAccounts.length === 0}
                      placeholder={t('commercialDocuments.editor.selectBankAccount')}
                      options={availableBankAccounts.map((account) => ({
                        value: account.id,
                        label: `${account.label} · ${account.bankName}${account.isDefault ? ' · ' + t('companyProfile.bank.default') : ''}`,
                      }))}
                      onChange={(event) => {
                        setBankSelection(event.target.value);
                        setBankSelectionDirty(true);
                      }}
                    />
                  )}
                </Field>
              </div>

              {availableBankAccounts.length === 0 ? (
                <div className="alert alert-warning" role="alert">
                  {t('commercialDocuments.editor.noBankAccountForCurrency', {
                    currency: detail.currency,
                  })}
                </div>
              ) : !bankSelection ? (
                <div className="alert alert-warning" role="status">
                  {t('commercialDocuments.editor.selectBankAccountHint')}
                </div>
              ) : null}

              <h3>{t('commercialDocuments.editor.paymentDetails')}</h3>
              {selectedBankAccount ? (
                <div className="payment-summary">
                  <dl className="definition-list">
                    {showField('payment', 'payment.accountHolder') ? (
                      <>
                        <dt>{t('companyProfile.bank.label')}</dt>
                        <dd>{selectedBankAccount.label}</dd>
                      </>
                    ) : null}
                    {showField('payment', 'payment.bankName') ? (
                      <>
                        <dt>{t('companyProfile.bank.bankName')}</dt>
                        <dd>{selectedBankAccount.bankName}</dd>
                      </>
                    ) : null}
                    {showField('payment', 'payment.accountNumber') ? (
                      <>
                        <dt>{t('companyProfile.bank.accountNumber')}</dt>
                        <dd className="mono">{selectedBankAccount.maskedAccountNumber}</dd>
                      </>
                    ) : null}
                    {showField('payment', 'payment.swift') ? (
                      <>
                        <dt>{t('companyProfile.bank.swiftCode')}</dt>
                        <dd>
                          {selectedBankAccount.hasSwift
                            ? t('companyProfile.bank.swiftConfigured')
                            : t('companyProfile.bank.swiftNotConfigured')}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                  {selectedBankAccount.isDefault ? (
                    <Badge tone="success">{t('companyProfile.bank.default')}</Badge>
                  ) : null}
                </div>
              ) : existingPayment ? (
                <div className="payment-summary">
                  <p className="muted">{t('commercialDocuments.editor.legacyPayment')}</p>
                  <dl className="definition-list">
                    {showField('payment', 'payment.accountHolder') ? (
                      <>
                        <dt>{t('commercialDocuments.editor.fields.accountHolder')}</dt>
                        <dd>{existingPayment.accountHolder || t('companyProfile.notProvided')}</dd>
                      </>
                    ) : null}
                    {showField('payment', 'payment.bankName') ? (
                      <>
                        <dt>{t('commercialDocuments.editor.fields.bankName')}</dt>
                        <dd>{existingPayment.bankName || t('companyProfile.notProvided')}</dd>
                      </>
                    ) : null}
                    {showField('payment', 'payment.accountNumber') ? (
                      <>
                        <dt>{t('commercialDocuments.editor.fields.accountNumber')}</dt>
                        <dd className="mono">{maskBankAccount(existingPayment.accountNumber)}</dd>
                      </>
                    ) : null}
                  </dl>
                </div>
              ) : (
                <p className="muted">{t('companyProfile.bank.empty')}</p>
              )}
              <p className="field-help">{t('commercialDocuments.editor.paymentServerHint')}</p>
            </section>
          ) : null}

          {itemColumns.length > 0 ? (
            <section className="panel stack-sm document-section">
              <h2>{t('commercialDocuments.editor.sections.items')}</h2>
              <div className="table-scroll">
                <table className="data-table document-items-table">
                  <thead>
                    <tr>
                      {itemColumns.map((column) => (
                        <th key={column}>
                          {t(`commercialDocuments.editor.items.${ITEM_COLUMN_LABEL_KEYS[column]}`)}
                        </th>
                      ))}
                      <th>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={`${item.lineNo}-${index}`}>
                        {itemColumns.map((column) => {
                          const field = ITEM_COLUMN_INPUT_FIELDS[column];
                          const label = t(
                            `commercialDocuments.editor.items.${ITEM_COLUMN_LABEL_KEYS[column]}`,
                          );
                          if (column === 'items.lineNo') {
                            return <td key={column}>{index + 1}</td>;
                          }
                          if (column === 'items.amount') {
                            const quantity = Number(item.quantity || '0');
                            const unitPrice = Number(item.unitPrice || '0');
                            const discount = Number(item.discountAmount || '0');
                            const value = quantity * unitPrice - discount;
                            return (
                              <td key={column} className="mono">
                                {Number.isFinite(value) ? value.toFixed(2) : '—'}
                              </td>
                            );
                          }
                          return (
                            <td key={column}>
                              {field ? (
                                <Input
                                  value={item[field]}
                                  disabled={!editable}
                                  aria-label={`${label} ${index + 1}`}
                                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                    updateItem(index, field, event.target.value)
                                  }
                                  maxLength={field === 'description' ? 2000 : 80}
                                />
                              ) : null}
                            </td>
                          );
                        })}
                        <td>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!editable || items.length <= 1}
                            onClick={() => {
                              setItems((current) =>
                                current.filter((_, itemIndex) => itemIndex !== index),
                              );
                              setDirty(true);
                            }}
                          >
                            {t('commercialDocuments.editor.items.remove')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {editable ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setItems((current) => [...current, blankItem(current.length + 1)]);
                    setDirty(true);
                  }}
                >
                  {t('commercialDocuments.editor.items.add')}
                </Button>
              ) : null}
            </section>
          ) : null}

          {showTotalsSection ? (
            <section className="panel stack-sm document-section">
              <h2>{t('commercialDocuments.editor.sections.totals')}</h2>
              {totalsFields.size > 0 ? (
                <div className="form-grid">
                  {(Object.entries(TOTALS_FIELD_KEYS) as Array<[TotalsEditorField, string]>)
                    .filter(([field]) => totalsFields.has(field))
                    .map(([field]) => (
                      <TextField
                        key={field}
                        label={t(`commercialDocuments.editor.fields.${TOTALS_LABEL_KEYS[field]}`)}
                        value={form[field]}
                        disabled={!editable}
                        onChange={(value) =>
                          updateForm((current) => ({ ...current, [field]: value }))
                        }
                      />
                    ))}
                </div>
              ) : null}
              <dl className="definition-list">
                {showField('totals', 'totals.subtotal') ? (
                  <>
                    <dt>{t('commercialDocuments.editor.fields.subtotal')}</dt>
                    <dd className="mono">{detail.totals.subtotal}</dd>
                  </>
                ) : null}
                {showField('totals', 'totals.grandTotal') ? (
                  <>
                    <dt>{t('commercialDocuments.editor.fields.total')}</dt>
                    <dd className="mono">
                      {detail.totals.totalAmount} {detail.currency}
                    </dd>
                  </>
                ) : null}
              </dl>
            </section>
          ) : null}

          {showDeclarationSection ? (
            <section className="panel stack-sm document-section">
              <h2>{t('commercialDocuments.editor.sections.declaration')}</h2>
              <div className="form-grid">
                {showField('declaration', 'declaration.countryOfOrigin') ? (
                  <TextField
                    label={t('commercialDocuments.editor.fields.originCountry')}
                    value={form.declaration.countryOfOrigin}
                    disabled={!editable}
                    onChange={(value) =>
                      updateForm((current) => ({
                        ...current,
                        declaration: {
                          ...current.declaration,
                          countryOfOrigin: value.toUpperCase().slice(0, 2),
                        },
                      }))
                    }
                  />
                ) : null}
                {showSignatureFields ? (
                  <>
                    <TextField
                      label={t('commercialDocuments.editor.fields.sellerName')}
                      value={form.signature.sellerName}
                      disabled={!editable}
                      onChange={(value) =>
                        updateForm((current) => ({
                          ...current,
                          signature: { ...current.signature, sellerName: value },
                        }))
                      }
                    />
                    <TextField
                      label={t('commercialDocuments.editor.fields.sellerTitle')}
                      value={form.signature.sellerTitle}
                      disabled={!editable}
                      onChange={(value) =>
                        updateForm((current) => ({
                          ...current,
                          signature: { ...current.signature, sellerTitle: value },
                        }))
                      }
                    />
                  </>
                ) : null}
              </div>
              {showField('declaration', 'declaration.text') ? (
                <AreaField
                  label={t('commercialDocuments.editor.fields.declarationText')}
                  value={form.declaration.text}
                  disabled={!editable}
                  onChange={(value) =>
                    updateForm((current) => ({
                      ...current,
                      declaration: { ...current.declaration, text: value },
                    }))
                  }
                />
              ) : null}
              {showField('declaration', 'declaration.authenticity') ? (
                <AreaField
                  label={t('commercialDocuments.editor.fields.authenticity')}
                  value={form.declaration.authenticityText}
                  disabled={!editable}
                  onChange={(value) =>
                    updateForm((current) => ({
                      ...current,
                      declaration: { ...current.declaration, authenticityText: value },
                    }))
                  }
                />
              ) : null}
              {showNotes ? (
                <AreaField
                  label={t('commercialDocuments.editor.fields.notes')}
                  value={form.notes}
                  disabled={!editable}
                  onChange={(value) => updateForm((current) => ({ ...current, notes: value }))}
                />
              ) : null}
            </section>
          ) : null}
        </div>

        <div className="stack document-preview-sticky">
          <section className="panel stack-sm">
            <div className="row-between">
              <h2>{t('commercialDocuments.actions.preview')}</h2>
              <Button
                size="sm"
                variant="secondary"
                loading={previewLoading}
                disabled={!canPreview}
                onClick={() => void doPreview()}
              >
                {t('commercialDocuments.actions.refresh')}
              </Button>
            </div>
            {previewError ? (
              <div className="alert alert-error" role="alert">
                {previewError}
              </div>
            ) : null}
            {previewHtml ? (
              <iframe
                className="document-preview-frame"
                title={`${detail.documentNo} preview`}
                srcDoc={previewHtml}
                sandbox=""
              />
            ) : (
              <p className="muted">{t('commercialDocuments.editor.previewUnavailable')}</p>
            )}
          </section>
          <section className="panel stack-sm">
            <h2>{t('commercialDocuments.columns.render')}</h2>
            <dl className="definition-list">
              <dt>{t('commercialDocuments.columns.status')}</dt>
              <dd>
                {detail.renderJob
                  ? t(`commercialDocuments.renderStatus.${detail.renderJob.status}`)
                  : t('commercialDocuments.renderStatus.none')}
              </dd>
              <dt>{t('commercialDocuments.columns.template')}</dt>
              <dd>
                {detail.template.name ?? '—'} v{detail.template.version ?? '—'}
              </dd>
              <dt>{t('commercialDocuments.editor.sections.totals')}</dt>
              <dd className="mono">
                {detail.totals.totalAmount} {detail.currency}
              </dd>
            </dl>
            {renderErrorCode ? (
              <div className="alert alert-error stack-sm" role="alert">
                <strong>{t('commercialDocuments.renderFailure.title')}</strong>
                <span>{translateError(locale, renderErrorCode)}</span>
                <span className="small muted mono">
                  {t('commercialDocuments.renderFailure.diagnostic', {
                    code: renderErrorCode,
                    jobId: detail.renderJob?.id ?? '—',
                  })}
                </span>
              </div>
            ) : null}
            {config ? (
              <p className="muted">
                {config.page.size} · {config.page.orientation} · {config.theme.fontFamily}
              </p>
            ) : null}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction === 'issue'}
        title={t('commercialDocuments.editor.issue')}
        description={t('commercialDocuments.editor.issueConfirm')}
        confirmLabel={t('commercialDocuments.editor.issue')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void doIssue()}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title={t('commercialDocuments.editor.cancel')}
        description={t('commercialDocuments.editor.cancelConfirm')}
        confirmLabel={t('commercialDocuments.editor.cancel')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void doCancel()}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'delete'}
        title={t('commercialDocuments.editor.delete')}
        description={t('commercialDocuments.editor.deleteConfirm')}
        confirmLabel={t('commercialDocuments.editor.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  disabled,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <Field label={label}>
      {({ inputId, describedBy }) => (
        <Input
          inputId={inputId}
          describedBy={describedBy}
          type={type}
          value={value}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function AreaField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      {({ inputId, describedBy }) => (
        <Textarea
          inputId={inputId}
          describedBy={describedBy}
          rows={3}
          value={value}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      {({ inputId, describedBy }) => (
        <Select
          inputId={inputId}
          describedBy={describedBy}
          value={value}
          disabled={disabled}
          options={options}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function PartyEditor({
  form,
  visibleFields,
  onChange,
  disabled,
  t,
}: {
  form: PartyState;
  visibleFields: ReadonlySet<PartyEditorField>;
  onChange: (next: PartyState) => void;
  disabled?: boolean;
  t: (key: string) => string;
}) {
  const update = (key: keyof PartyState) => (value: string) => onChange({ ...form, [key]: value });
  return (
    <div className="form-grid">
      {visibleFields.has('companyName') ? (
        <TextField
          label={t('commercialDocuments.editor.fields.companyName')}
          value={form.companyName}
          onChange={update('companyName')}
          disabled={disabled}
        />
      ) : null}
      {visibleFields.has('contactName') ? (
        <TextField
          label={t('commercialDocuments.editor.fields.contactName')}
          value={form.contactName}
          onChange={update('contactName')}
          disabled={disabled}
        />
      ) : null}
      {visibleFields.has('phone') ? (
        <TextField
          label={t('commercialDocuments.editor.fields.phone')}
          value={form.phone}
          onChange={update('phone')}
          disabled={disabled}
        />
      ) : null}
      {visibleFields.has('email') ? (
        <TextField
          label={t('commercialDocuments.editor.fields.email')}
          value={form.email}
          onChange={update('email')}
          disabled={disabled}
        />
      ) : null}
      {visibleFields.has('taxId') ? (
        <TextField
          label={t('commercialDocuments.editor.fields.taxId')}
          value={form.taxId}
          onChange={update('taxId')}
          disabled={disabled}
        />
      ) : null}
      {visibleFields.has('address') ? (
        <>
          <TextField
            label={t('commercialDocuments.editor.fields.addressLine1')}
            value={form.line1}
            onChange={update('line1')}
            disabled={disabled}
          />
          <TextField
            label={t('commercialDocuments.editor.fields.addressLine2')}
            value={form.line2}
            onChange={update('line2')}
            disabled={disabled}
          />
          <TextField
            label={t('commercialDocuments.editor.fields.city')}
            value={form.city}
            onChange={update('city')}
            disabled={disabled}
          />
          <TextField
            label={t('commercialDocuments.editor.fields.state')}
            value={form.state}
            onChange={update('state')}
            disabled={disabled}
          />
          <TextField
            label={t('commercialDocuments.editor.fields.postalCode')}
            value={form.postalCode}
            onChange={update('postalCode')}
            disabled={disabled}
          />
          <TextField
            label={t('commercialDocuments.editor.fields.countryCode')}
            value={form.countryCode}
            onChange={(value) =>
              onChange({ ...form, countryCode: value.toUpperCase().slice(0, 2) })
            }
            disabled={disabled}
          />
        </>
      ) : null}
    </div>
  );
}
