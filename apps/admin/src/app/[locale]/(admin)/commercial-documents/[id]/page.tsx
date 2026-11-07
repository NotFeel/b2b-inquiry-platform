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
import { AdminApiError } from '../../../../../lib/admin-api';
import { commercialDocumentsApi } from '../../../../../lib/commercial-documents-api';
import {
  commercialDocumentFieldLabel,
  commercialDocumentLocaleLabel,
} from '../../../../../lib/commercial-document-labels';
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
};

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'issue' | 'cancel' | null>(null);

  const editable = detail ? detail.status === 'DRAFT' || detail.status === 'REVIEW' : false;
  const canUpdate = can('commercial_document.update');
  const canPreview = can('commercial_document.preview');
  const canIssue = can('commercial_document.issue');
  const canDownload = can('commercial_document.download');
  const canRevise = can('commercial_document.revision.create');
  const canCancel = can('commercial_document.cancel');

  const applyDetail = useCallback((next: CommercialDocumentDetail) => {
    setDetail(next);
    setForm(buildForm(next));
    setItems(next.items.map(itemFromDoc));
    setTemplateVersionId(next.template.versionId ?? '');
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
        logoAssetId: (detail.seller as Record<string, unknown>).logoAssetId ?? null,
        stampAssetId: (detail.seller as Record<string, unknown>).stampAssetId ?? null,
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
      payment: { ...form.payment },
      declaration: { ...form.declaration, countryOfOrigin: form.declaration.countryOfOrigin || null },
      signature: {
        sellerName: form.signature.sellerName,
        sellerTitle: form.signature.sellerTitle,
        stampAssetId:
          (detail.signature as Record<string, unknown> | null)?.stampAssetId ??
          (detail.seller as Record<string, unknown>).stampAssetId ??
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
  }, [detail, form, items, templateVersionId]);

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
    try {
      await commercialDocumentsApi.renderDocument(detail.id);
      toast.success(t('commercialDocuments.editor.rendered'));
      await load();
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

  const missingLabels = useMemo(
    () => (detail ? detail.missingFieldLabels : []),
    [detail],
  );
  const missingItemLines = useMemo(
    () => (detail ? detail.missingItemLines : []),
    [detail],
  );

  const config: DocumentTemplateConfig | null = detail?.config ?? null;

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
      {missingLabels.length > 0 || missingItemLines.length > 0 ? (
        <div className="alert alert-warning">
          <strong>{t('commercialDocuments.editor.missingTitle')}</strong>
          <ul>
            {missingLabels.map((field) => (
              <li key={field.key}>{commercialDocumentFieldLabel(field.key, t)}</li>
            ))}
            {missingItemLines.map((line) => (
              <li key={`line-${line.lineNo}`}>
                {t('commercialDocuments.editor.missingItemLine', {
                  line: line.lineNo,
                  fields: line.fields.map((field) => commercialDocumentFieldLabel(field, t)).join(', '),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
          <Button onClick={() => setConfirmAction('issue')}>{t('commercialDocuments.editor.issue')}</Button>
        ) : null}
        {canPreview ? (
          <Button variant="secondary" loading={busy} onClick={() => void doRender()}>
            {t('commercialDocuments.editor.render')}
          </Button>
        ) : null}
        {canDownload ? (
          <Button variant="secondary" disabled={!detail.pdf.available} onClick={() => void doDownload()}>
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
      </div>

      <div className="document-workbench">
        <div className="stack">
          <section className="panel stack-sm document-section">
            <h2>{t('commercialDocuments.editor.sections.document')}</h2>
            <div className="form-grid">
              <TextField
                label={t('commercialDocuments.editor.fields.documentNo')}
                value={detail.documentNo}
                disabled
                onChange={() => undefined}
              />
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
                      `${option.name} v${option.version} · ${commercialDocumentLocaleLabel(option.locale, t)}`,
                    );
                  }
                  return [...options].map(([value, label]) => ({ value, label }));
                })()}
                disabled={!editable}
                onChange={(value) => {
                  setTemplateVersionId(value);
                  setDirty(true);
                }}
              />
              <SelectField
                label={t('commercialDocuments.editor.fields.locale')}
                value={form.locale}
                options={[
                  { value: 'en-US', label: commercialDocumentLocaleLabel('en-US', t) },
                  { value: 'zh-CN', label: commercialDocumentLocaleLabel('zh-CN', t) },
                ]}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, locale: value }))}
              />
              <TextField
                label={t('commercialDocuments.editor.fields.issueDate')}
                type="date"
                value={form.issueDate}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, issueDate: value }))}
              />
              <TextField
                label={t('commercialDocuments.editor.fields.validUntil')}
                type="date"
                value={form.validUntil}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, validUntil: value }))}
              />
              <TextField
                label={t('commercialDocuments.editor.fields.currency')}
                value={detail.currency}
                disabled
                onChange={() => undefined}
              />
            </div>
          </section>

          <section className="panel stack-sm document-section">
            <h2>{t('commercialDocuments.editor.sections.seller')}</h2>
            <PartyEditor
              form={form.seller}
              disabled={!editable}
              onChange={(next) => updateForm((current) => ({ ...current, seller: next }))}
              t={t}
            />
          </section>

          <section className="panel stack-sm document-section">
            <h2>{t('commercialDocuments.editor.sections.buyer')}</h2>
            <PartyEditor
              form={form.buyer}
              disabled={!editable}
              onChange={(next) => updateForm((current) => ({ ...current, buyer: next }))}
              t={t}
            />
          </section>

          <section className="panel stack-sm document-section">
            <h2>{t('commercialDocuments.editor.sections.consignee')}</h2>
            <PartyEditor
              form={form.consignee}
              disabled={!editable}
              onChange={(next) => updateForm((current) => ({ ...current, consignee: next }))}
              t={t}
            />
          </section>

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
                disabled={!editable}
                onChange={(next) => updateForm((current) => ({ ...current, notify: next }))}
                t={t}
              />
            ) : null}
          </section>

          <section className="panel stack-sm document-section">
            <h2>{t('commercialDocuments.editor.sections.trade')}</h2>
            <div className="form-grid">
              <TextField
                label={t('commercialDocuments.editor.fields.incoterm')}
                value={form.trade.incotermCode}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, trade: { ...current.trade, incotermCode: value } }))}
              />
              <TextField
                label={t('commercialDocuments.editor.fields.namedPlace')}
                value={form.trade.namedPlace}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, trade: { ...current.trade, namedPlace: value } }))}
              />
              <TextField
                label={t('commercialDocuments.editor.fields.paymentTerms')}
                value={form.trade.paymentTerms}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, trade: { ...current.trade, paymentTerms: value } }))}
              />
              <TextField
                label={t('commercialDocuments.orderDetail.buyerReference')}
                value={form.trade.buyerReference}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, trade: { ...current.trade, buyerReference: value } }))}
              />
              <TextField
                label={t('commercialDocuments.orderDetail.contractNo')}
                value={form.trade.contractNo}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, trade: { ...current.trade, contractNo: value } }))}
              />
              <TextField
                label={t('commercialDocuments.editor.fields.exchangeRate')}
                value={String((detail.trade as Record<string, unknown> | null)?.exchangeRateText ?? '—')}
                disabled
                onChange={() => undefined}
              />
            </div>
          </section>

          <section className="panel stack-sm document-section">
            <h2>{t('commercialDocuments.editor.sections.shipping')}</h2>
            <div className="form-grid">
              {(
                [
                  ['method', 'shippingMethod'],
                  ['portOfLoading', 'portOfLoading'],
                  ['portOfDischarge', 'portOfDischarge'],
                  ['route', 'route'],
                  ['transitTime', 'transitTime'],
                  ['cartonCount', 'cartonCount'],
                  ['netWeightKg', 'netWeightKg'],
                  ['grossWeightKg', 'grossWeightKg'],
                  ['cbm', 'cbm'],
                  ['marks', 'marks'],
                ] as const
              ).map(([field, label]) => (
                <TextField
                  key={field}
                  label={t(`commercialDocuments.editor.fields.${label}`)}
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

          <section className="panel stack-sm document-section">
            <h2>{t('commercialDocuments.editor.sections.payment')}</h2>
            {profiles.length > 0 ? (
              <Select
                value={bankSelection}
                disabled={!editable}
                placeholder={t('companyProfile.banks')}
                aria-label={t('companyProfile.banks')}
                options={profiles.flatMap((profile) =>
                  profile.bankAccounts.map((account) => ({
                    value: account.id,
                    label: `${profile.companyName} · ${account.label}${
                      account.currencyCode ? ` (${account.currencyCode})` : ''
                    }`,
                  })),
                )}
                onChange={(event) => {
                  const selectedBank = profiles
                    .flatMap((profile) => profile.bankAccounts)
                    .find((account) => account.id === event.target.value);
                  setBankSelection(event.target.value);
                  if (!selectedBank) return;
                  updateForm((current) => ({
                    ...current,
                    payment: {
                      accountHolder: selectedBank.accountHolder,
                      bankName: selectedBank.bankName,
                      bankAddress: selectedBank.bankAddress ?? '',
                      accountNumber: selectedBank.accountNumber,
                      swiftCode: selectedBank.swiftCode ?? '',
                      wireRoutingNumber: selectedBank.wireRoutingNumber ?? '',
                      achRoutingNumber: selectedBank.achRoutingNumber ?? '',
                    },
                  }));
                }}
              />
            ) : null}
            <div className="form-grid">
              {(
                [
                  ['accountHolder', 'accountHolder'],
                  ['bankName', 'bankName'],
                  ['bankAddress', 'bankAddress'],
                  ['accountNumber', 'accountNumber'],
                  ['swiftCode', 'swift'],
                  ['wireRoutingNumber', 'wireRouting'],
                  ['achRoutingNumber', 'achRouting'],
                ] as const
              ).map(([field, label]) => (
                <TextField
                  key={field}
                  label={t(`commercialDocuments.editor.fields.${label}`)}
                  value={form.payment[field]}
                  disabled={!editable}
                  onChange={(value) =>
                    updateForm((current) => ({
                      ...current,
                      payment: { ...current.payment, [field]: value },
                    }))
                  }
                />
              ))}
            </div>
          </section>

          <section className="panel stack-sm document-section">
            <h2>{t('commercialDocuments.editor.sections.items')}</h2>
            <div className="table-scroll">
              <table className="data-table document-items-table" style={{ minWidth: '1400px' }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('commercialDocuments.editor.items.sku')}</th>
                    <th>{t('commercialDocuments.editor.items.description')}</th>
                    <th>{t('commercialDocuments.editor.items.hsCode')}</th>
                    <th>{t('commercialDocuments.editor.items.origin')}</th>
                    <th>{t('commercialDocuments.editor.items.quantity')}</th>
                    <th>{t('commercialDocuments.editor.items.unit')}</th>
                    <th>{t('commercialDocuments.editor.items.unitPrice')}</th>
                    <th>{t('commercialDocuments.editor.items.discount')}</th>
                    <th>{t('commercialDocuments.editor.items.amount')}</th>
                    <th>{t('commercialDocuments.editor.items.cartons')}</th>
                    <th>{t('commercialDocuments.editor.items.grossWeight')}</th>
                    <th>{t('commercialDocuments.editor.items.cbm')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={`${item.lineNo}-${index}`}>
                      <td>{index + 1}</td>
                      {(
                        ['sku', 'description', 'hsCode', 'originCountryCode', 'quantity', 'unit', 'unitPrice', 'discountAmount', 'cartons', 'grossWeightKg', 'cbm'] as const
                      ).map((field) => (
                        <td key={field}>
                          <Input
                            value={item[field]}
                            disabled={!editable}
                            aria-label={`${itemFieldLabel(field, t)} ${index + 1}`}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              updateItem(index, field, event.target.value)
                            }
                            maxLength={field === 'description' ? 2000 : 80}
                          />
                        </td>
                      ))}
                      <td className="mono">
                        {(() => {
                          const quantity = Number(item.quantity || '0');
                          const unitPrice = Number(item.unitPrice || '0');
                          const discount = Number(item.discountAmount || '0');
                          const value = quantity * unitPrice - discount;
                          return Number.isFinite(value) ? value.toFixed(2) : '—';
                        })()}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!editable || items.length <= 1}
                          onClick={() => {
                            setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
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

          <section className="panel stack-sm document-section">
            <h2>{t('commercialDocuments.editor.sections.totals')}</h2>
            <div className="form-grid">
              <TextField
                label={t('commercialDocuments.editor.fields.discount')}
                value={form.discountAmount}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, discountAmount: value }))}
              />
              <TextField
                label={t('commercialDocuments.editor.fields.freight')}
                value={form.freightAmount}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, freightAmount: value }))}
              />
              <TextField
                label={t('commercialDocuments.editor.fields.insurance')}
                value={form.insuranceAmount}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, insuranceAmount: value }))}
              />
              <TextField
                label={t('commercialDocuments.editor.fields.otherCharges')}
                value={form.otherCharges}
                disabled={!editable}
                onChange={(value) => updateForm((current) => ({ ...current, otherCharges: value }))}
              />
            </div>
            <dl className="definition-list">
              <dt>{t('commercialDocuments.editor.fields.subtotal')}</dt>
              <dd className="mono">{detail.totals.subtotal}</dd>
              <dt>{t('commercialDocuments.editor.fields.total')}</dt>
              <dd className="mono">
                {detail.totals.totalAmount} {detail.currency}
              </dd>
            </dl>
          </section>

          <section className="panel stack-sm document-section">
            <h2>{t('commercialDocuments.editor.sections.declaration')}</h2>
            <div className="form-grid">
              <TextField
                label={t('commercialDocuments.editor.fields.originCountry')}
                value={form.declaration.countryOfOrigin}
                disabled={!editable}
                onChange={(value) =>
                  updateForm((current) => ({
                    ...current,
                    declaration: { ...current.declaration, countryOfOrigin: value.toUpperCase().slice(0, 2) },
                  }))
                }
              />
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
            </div>
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
            <AreaField
              label={t('commercialDocuments.editor.fields.notes')}
              value={form.notes}
              disabled={!editable}
              onChange={(value) => updateForm((current) => ({ ...current, notes: value }))}
            />
          </section>
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

function itemFieldLabel(
  field:
    | 'sku'
    | 'description'
    | 'hsCode'
    | 'originCountryCode'
    | 'quantity'
    | 'unit'
    | 'unitPrice'
    | 'discountAmount'
    | 'cartons'
    | 'grossWeightKg'
    | 'cbm',
  t: (key: string) => string,
): string {
  const key =
    field === 'originCountryCode'
      ? 'origin'
      : field === 'discountAmount'
        ? 'discount'
        : field === 'grossWeightKg'
          ? 'grossWeight'
          : field;
  return t(`commercialDocuments.editor.items.${key}`);
}

function PartyEditor({
  form,
  onChange,
  disabled,
  t,
}: {
  form: PartyState;
  onChange: (next: PartyState) => void;
  disabled?: boolean;
  t: (key: string) => string;
}) {
  const update = (key: keyof PartyState) => (value: string) =>
    onChange({ ...form, [key]: value });
  return (
    <div className="form-grid">
      <TextField label={t('commercialDocuments.editor.fields.companyName')} value={form.companyName} onChange={update('companyName')} disabled={disabled} />
      <TextField label={t('commercialDocuments.editor.fields.contactName')} value={form.contactName} onChange={update('contactName')} disabled={disabled} />
      <TextField label={t('commercialDocuments.editor.fields.phone')} value={form.phone} onChange={update('phone')} disabled={disabled} />
      <TextField label={t('commercialDocuments.editor.fields.email')} value={form.email} onChange={update('email')} disabled={disabled} />
      <TextField label={t('commercialDocuments.editor.fields.taxId')} value={form.taxId} onChange={update('taxId')} disabled={disabled} />
      <TextField label={t('commercialDocuments.editor.fields.addressLine1')} value={form.line1} onChange={update('line1')} disabled={disabled} />
      <TextField label={t('commercialDocuments.editor.fields.addressLine2')} value={form.line2} onChange={update('line2')} disabled={disabled} />
      <TextField label={t('commercialDocuments.editor.fields.city')} value={form.city} onChange={update('city')} disabled={disabled} />
      <TextField label={t('commercialDocuments.editor.fields.state')} value={form.state} onChange={update('state')} disabled={disabled} />
      <TextField label={t('commercialDocuments.editor.fields.postalCode')} value={form.postalCode} onChange={update('postalCode')} disabled={disabled} />
      <TextField
        label={t('commercialDocuments.editor.fields.countryCode')}
        value={form.countryCode}
        onChange={(value) => onChange({ ...form, countryCode: value.toUpperCase().slice(0, 2) })}
        disabled={disabled}
      />
    </div>
  );
}
