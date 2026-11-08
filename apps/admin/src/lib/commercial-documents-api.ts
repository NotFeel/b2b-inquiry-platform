'use client';

import {
  adminApi,
  downloadAdminFileGet,
  type AdminFileDownload,
  type PaginatedResponse,
} from './admin-api';

export type DocumentAddress = {
  recipient?: string | null;
  companyName?: string | null;
  phoneE164?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
};

export type DocumentParty = {
  companyName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
  countryCode?: string | null;
  billingAddress?: DocumentAddress | null;
  shippingAddress?: DocumentAddress | null;
  address?: DocumentAddress | null;
};

export type DocumentTrade = {
  incotermCode?: string | null;
  namedPlace?: string | null;
  paymentTerms?: string | null;
  contractNo?: string | null;
  buyerReference?: string | null;
  exchangeRateText?: string | null;
};

export type DocumentShipping = {
  method?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  route?: string | null;
  transitTime?: string | null;
  cartonCount?: number | null;
  netWeightKg?: string | null;
  grossWeightKg?: string | null;
  cbm?: string | null;
  marks?: string | null;
};

export type DocumentPayment = {
  label?: string | null;
  accountHolder?: string | null;
  bankName?: string | null;
  bankAddress?: string | null;
  accountNumber?: string | null;
  swiftCode?: string | null;
  wireRoutingNumber?: string | null;
  achRoutingNumber?: string | null;
  bankCountryCode?: string | null;
  currencyCode?: string | null;
};

export type DocumentDeclaration = {
  countryOfOrigin?: string | null;
  text?: string | null;
  authenticityText?: string | null;
};

export type DocumentSignature = {
  sellerName?: string | null;
  sellerTitle?: string | null;
  stampAssetId?: string | null;
};

export type OrderDocumentSummary = {
  id: string;
  type: 'PI' | 'CI';
  documentNo: string;
  revisionNo: number;
  status: string;
  currency: string;
  totalAmount: string;
  hasPdf: boolean;
  createdAt: string;
  updatedAt: string;
  issuedAt?: string | null;
};

export type OrderListRow = {
  id: string;
  orderNo: string;
  status: string;
  currencyCode: string;
  totalAmountCny: string;
  totalAmountForeign: string;
  orderDate: string;
  updatedAt?: string | null;
  version: number;
  buyer?: DocumentParty | null;
  itemSummary?: {
    lineCount: number;
    totalQuantity: string;
    totalCartons: number;
  };
  documents?: {
    piCount: number;
    ciCount: number;
    latest: OrderDocumentSummary | null;
    pi: OrderDocumentSummary | null;
    ci: OrderDocumentSummary | null;
  };
};

export type OrderItemRow = {
  id: string;
  lineNo: number;
  sku: string;
  productName: string;
  quantity: string;
  lineAmountCny: string;
  lineAmountForeign: string;
  unitSalePriceForeign?: string;
  costCny?: string;
  packaging?: {
    cartonCount?: number | null;
    unitsPerCarton?: number | null;
    cartonLengthCm?: string | null;
    cartonWidthCm?: string | null;
    cartonHeightCm?: string | null;
    cartonGrossWeightKg?: string | null;
    cartonVolumeCbm?: string | null;
    totalCbm?: string | null;
  };
};

export type OrderFeeRow = {
  id: string;
  typeCode: string;
  name: string;
  amountCny: string;
  amountForeign: string;
  isFreight?: boolean;
};

export type OrderDetail = {
  id: string;
  orderNo: string;
  status: string;
  currencyCode: string;
  exchangeRate: string;
  exchangeRateDate: string;
  orderDate: string;
  version: number;
  totalAmountCny: string;
  totalAmountForeign: string;
  buyer: DocumentParty | null;
  consignee: DocumentParty | null;
  notifyParty: DocumentParty | null;
  trade: DocumentTrade | null;
  buyerReference: string | null;
  contractNo: string | null;
  customer: Record<string, unknown>;
  items: OrderItemRow[];
  fees: OrderFeeRow[];
  documents: Array<{
    id: string;
    type: 'PI' | 'CI';
    documentNo: string;
    revisionNo: number;
    status: string;
    currency: string;
    totalAmount: string;
    issueDate: string | null;
    issuedAt: string | null;
    templateVersion: number | null;
    hasPdf: boolean;
    createdAt: string;
  }>;
  auditTrail: Array<{
    id: string;
    action: string;
    actor: string | null;
    createdAt: string;
    metadata: unknown;
  }>;
};

export type CommercialDocumentItem = {
  id?: string;
  lineNo: number;
  productId?: string | null;
  sku: string;
  description: string | null;
  hsCode: string;
  originCountryCode: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountAmount: string;
  lineAmount: string;
  currency: string;
  cartons: number | null;
  unitsPerCarton: number | null;
  netWeightKg: string | null;
  grossWeightKg: string | null;
  cbm: string | null;
  packaging?: unknown;
};

export type DocumentTotals = {
  subtotal: string;
  discountAmount: string;
  freightAmount: string;
  insuranceAmount: string;
  otherCharges: string;
  totalAmount: string;
};

export type CommercialDocumentSummary = {
  id: string;
  type: 'PI' | 'CI';
  documentNo: string;
  revisionNo: number;
  status: string;
  currency: string;
  totalAmount: string;
  issueDate: string | null;
  issuedAt: string | null;
  orderId: string | null;
  orderNo: string | null;
  buyerName: string | null;
  sellerName: string | null;
  templateName: string | null;
  templateVersion: number | null;
  hasPdf: boolean;
  renderStatus: string | null;
  renderErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DocumentTemplateConfig = {
  schemaVersion: 1;
  page: {
    size: 'A4' | 'Letter';
    orientation: 'portrait' | 'landscape';
    marginMm: { top: number; right: number; bottom: number; left: number };
  };
  theme: {
    primaryColor: string;
    accentColor: string;
    fontFamily: string;
    fontSizePt: number;
  };
  header: {
    title: string;
    subtitle?: string;
    showLogo: boolean;
    showStamp: boolean;
    showDocumentType: boolean;
  };
  sections: Array<{
    key: string;
    visible: boolean;
    title?: string;
    fields: Array<{ key: string; visible: boolean; required: boolean; label?: string }>;
  }>;
  itemColumns: Array<{ key: string; visible: boolean; label?: string; width?: number }>;
  footer: { text?: string; showText: boolean; showPageNumbers: boolean };
  terms: {
    paymentNotice?: string;
    shipmentNotice?: string;
    authenticityDeclaration?: string;
    showPaymentNotice: boolean;
    showShipmentNotice: boolean;
    showAuthenticityDeclaration: boolean;
  };
  notes: { visible: boolean; title?: string };
};

export type CommercialDocumentDetail = {
  id: string;
  type: 'PI' | 'CI';
  documentNo: string;
  revisionNo: number;
  status: string;
  locale: string;
  currency: string;
  issueDate: string | null;
  validUntil: string | null;
  version: number;
  orderId: string | null;
  orderNo: string | null;
  companyProfileId: string | null;
  bankAccountId: string | null;
  buyerReference: string | null;
  contractNo: string | null;
  exchangeRateText: string | null;
  seller: Record<string, unknown>;
  buyer: Record<string, unknown>;
  consignee: Record<string, unknown> | null;
  notifyParty: Record<string, unknown> | null;
  trade: DocumentTrade | null;
  shipping: DocumentShipping | null;
  payment: DocumentPayment | null;
  declaration: DocumentDeclaration | null;
  signature: DocumentSignature | null;
  notes: string | null;
  items: CommercialDocumentItem[];
  totals: DocumentTotals;
  template: {
    id: string | null;
    name: string | null;
    versionId: string | null;
    version: number | null;
    status: string | null;
  };
  missingFields: string[];
  missingFieldLabels: Array<{ key: string; label: string }>;
  missingItemLines: Array<{ lineNo: number; fields: string[] }>;
  pdf: {
    available: boolean;
    generatedAt: string | null;
    sha256: string | null;
    sizeBytes: number | null;
  };
  renderJob: {
    id: string;
    status: string;
    errorCode: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  issuedAt: string | null;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
  config: DocumentTemplateConfig;
};

export type DocumentPrefill = {
  orderId: string;
  orderNo: string;
  documentType: 'PI' | 'CI';
  currency: string;
  companyProfileId: string | null;
  bankAccountId: string | null;
  bankAccount: BankAccountProfile | null;
  bankAccountStatus: 'MATCHED' | 'SELECT_REQUIRED' | 'MISSING';
  bankAccounts: BankAccountProfile[];
  buyer: DocumentParty;
  consignee: DocumentParty | null;
  notifyParty: DocumentParty | null;
  seller: DocumentParty;
  trade: DocumentTrade;
  shipping: DocumentShipping;
  payment: DocumentPayment | null;
  declaration: DocumentDeclaration;
  items: CommercialDocumentItem[];
  totals: DocumentTotals;
  template: { id: string; versionId: string; version: number; name: string; locale: string };
  templateOptions: Array<{
    id: string;
    name: string;
    documentType: 'PI' | 'CI';
    locale: string;
    paperSize: string;
    orientation: string;
    isDefault: boolean;
    versionId: string;
    version: number;
  }>;
  missingFields: string[];
  missingFieldLabels: Array<{ key: string; label: string }>;
  missingItemLines: Array<{ lineNo: number; fields: string[] }>;
};

export type DocumentTemplateSummary = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  documentType: 'PI' | 'CI';
  locale: string;
  paperSize: string;
  orientation: string;
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  isDefault: boolean;
  draftConfig: DocumentTemplateConfig;
  currentVersion: {
    id: string;
    version: number;
    checksum: string;
    publishedAt: string;
  } | null;
  versionCount: number;
  updatedAt: string;
};

export type DocumentTemplateDetail = DocumentTemplateSummary & {
  versions: Array<{
    id: string;
    version: number;
    status: string;
    checksum: string;
    publishedAt: string;
  }>;
  createdBy: string | null;
  updatedBy: string | null;
};

export type BankAccountProfile = {
  id: string;
  label: string;
  bankName: string;
  currencyCode: string | null;
  bankCountryCode: string | null;
  isDefault: boolean;
  enabled: boolean;
  hasSwift: boolean;
  maskedAccountNumber: string;
};

/** Full account data is only returned by the protected bank-account detail API. */
export type BankAccountDetail = BankAccountProfile & {
  companyProfileId: string;
  accountHolder: string;
  bankAddress: string | null;
  accountNumber: string;
  swiftCode: string | null;
  wireRoutingNumber: string | null;
  achRoutingNumber: string | null;
  sortOrder: number;
  hasSwift: boolean;
};

export type CompanyProfile = {
  id: string;
  code: string;
  companyName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  website: string | null;
  address: DocumentAddress;
  logoAssetId: string | null;
  stampAssetId: string | null;
  logoUrl: string | null;
  stampUrl: string | null;
  isDefault: boolean;
  enabled: boolean;
  updatedAt?: string;
  bankAccounts?: BankAccountProfile[];
};

export type CompanyAssetKind = 'logo' | 'stamp';

export type CompanyAssetRemoval = {
  profile: CompanyProfile;
  assetId: string | null;
  removed: boolean;
  deletionJobId: string | null;
};

export type UploadedCompanyAssetRemoval = {
  assetId: string;
  removed: boolean;
  deletionJobId: string | null;
};

export type TemplateValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  documentType?: 'PI' | 'CI';
  locale?: string;
  fieldCount?: number;
  columnCount?: number;
};

export const commercialDocumentsApi = {
  orders: (query: Record<string, string | number | boolean | undefined>) =>
    adminApi.list<OrderListRow>('/admin/orders', query),
  orderDetail: async (id: string) =>
    (await adminApi.get<{ data: OrderDetail }>(`/admin/orders/${id}`)).data,
  updateOrderCustomerSnapshot: async (id: string, payload: Record<string, unknown>) =>
    (await adminApi.patch<{ data: OrderDetail }>(`/admin/orders/${id}/customer-snapshot`, payload))
      .data,
  syncOrderCustomerProfile: async (id: string, version: number) =>
    adminApi.post<{ data: { customerId: string } }>(`/admin/orders/${id}/sync-customer-profile`, {
      version,
      confirm: true,
    }),
  prefill: async (orderId: string, type: 'PI' | 'CI') =>
    (
      await adminApi.get<{ data: DocumentPrefill }>(`/admin/orders/${orderId}/document-prefill`, {
        type,
      })
    ).data,
  createFromOrder: async (orderId: string, payload: Record<string, unknown>) =>
    (
      await adminApi.post<{ data: CommercialDocumentDetail }>(
        `/admin/orders/${orderId}/commercial-documents`,
        payload,
      )
    ).data,
  documents: (query: Record<string, string | number | boolean | undefined>) =>
    adminApi.list<CommercialDocumentSummary>('/admin/commercial-documents', query),
  document: async (id: string) =>
    (await adminApi.get<{ data: CommercialDocumentDetail }>(`/admin/commercial-documents/${id}`))
      .data,
  updateDocument: async (id: string, payload: Record<string, unknown>) =>
    (
      await adminApi.patch<{ data: CommercialDocumentDetail }>(
        `/admin/commercial-documents/${id}`,
        payload,
      )
    ).data,
  previewDocument: async (id: string) =>
    (
      await adminApi.post<{
        data: {
          html: string;
          missingFields: string[];
          documentNo: string;
          revisionNo: number;
        };
      }>(`/admin/commercial-documents/${id}/preview`)
    ).data,
  renderDocument: async (id: string) =>
    (
      await adminApi.post<{
        data: { id: string; status: string; errorCode: string | null };
      }>(`/admin/commercial-documents/${id}/render`)
    ).data,
  issueDocument: async (id: string, version: number) =>
    (
      await adminApi.post<{ data: CommercialDocumentDetail }>(
        `/admin/commercial-documents/${id}/issue`,
        { version },
      )
    ).data,
  reviseDocument: async (id: string) =>
    (
      await adminApi.post<{ data: CommercialDocumentDetail }>(
        `/admin/commercial-documents/${id}/revisions`,
      )
    ).data,
  cancelDocument: async (id: string, reason?: string) =>
    (
      await adminApi.post<{ data: CommercialDocumentDetail }>(
        `/admin/commercial-documents/${id}/cancel`,
        { reason: reason ?? null },
      )
    ).data,
  downloadDocument: (id: string, filename: string) =>
    downloadAdminFileGet(`/admin/commercial-documents/${id}/download`, filename),

  templates: (query: Record<string, string | number | boolean | undefined>) =>
    adminApi.list<DocumentTemplateSummary>('/admin/document-templates', query),
  template: async (id: string) =>
    (await adminApi.get<{ data: DocumentTemplateDetail }>(`/admin/document-templates/${id}`)).data,
  activeTemplateOptions: async () =>
    (
      await adminApi.get<{
        data: Array<{
          id: string;
          name: string;
          documentType: 'PI' | 'CI';
          locale: string;
          paperSize: string;
          orientation: string;
          isDefault: boolean;
          versionId: string;
          version: number;
        }>;
      }>('/admin/document-templates/active-options')
    ).data,
  createTemplate: async (payload: Record<string, unknown>) =>
    (await adminApi.post<{ data: DocumentTemplateDetail }>('/admin/document-templates', payload))
      .data,
  updateTemplate: async (id: string, payload: Record<string, unknown>) =>
    (
      await adminApi.patch<{ data: DocumentTemplateDetail }>(
        `/admin/document-templates/${id}`,
        payload,
      )
    ).data,
  validateTemplate: async (id: string, payload: Record<string, unknown> = {}) =>
    (
      await adminApi.post<{ data: TemplateValidation }>(
        `/admin/document-templates/${id}/validate`,
        payload,
      )
    ).data,
  previewTemplate: async (id: string, payload: Record<string, unknown>) =>
    (
      await adminApi.post<{
        data: {
          html: string;
          sample: boolean;
          documentType: 'PI' | 'CI';
          locale: string;
        };
      }>(`/admin/document-templates/${id}/preview`, payload)
    ).data,
  publishTemplate: async (id: string) =>
    (
      await adminApi.post<{ data: DocumentTemplateDetail }>(
        `/admin/document-templates/${id}/publish`,
        {},
      )
    ).data,
  deleteTemplate: async (id: string) =>
    (await adminApi.delete<{ data: { deleted: true } }>(`/admin/document-templates/${id}`)).data,

  companyProfiles: async () =>
    (await adminApi.get<{ data: CompanyProfile[] }>('/admin/company-profiles')).data,
  companyProfileOptions: async () =>
    (
      await adminApi.get<{
        data: Array<{
          id: string;
          companyName: string;
          contactName: string | null;
          phone: string | null;
          email: string | null;
          taxId: string | null;
          isDefault: boolean;
          address: DocumentAddress;
          logoAssetId: string | null;
          stampAssetId: string | null;
          logoUrl: string | null;
          stampUrl: string | null;
          bankAccounts: BankAccountProfile[];
        }>;
      }>('/admin/company-profiles/options')
    ).data,
  createCompanyProfile: async (payload: Record<string, unknown>) =>
    (await adminApi.post<{ data: CompanyProfile }>('/admin/company-profiles', payload)).data,
  createCompanyProfileWithBankAccounts: async (payload: Record<string, unknown>) =>
    (
      await adminApi.post<{ data: CompanyProfile }>(
        '/admin/company-profiles/with-bank-accounts',
        payload,
      )
    ).data,
  updateCompanyProfile: async (id: string, payload: Record<string, unknown>) =>
    (await adminApi.patch<{ data: CompanyProfile }>(`/admin/company-profiles/${id}`, payload)).data,
  deleteCompanyProfile: (id: string) =>
    adminApi.delete<{ data: { deleted: true } }>(`/admin/company-profiles/${id}`),
  removeCompanyAsset: async (id: string, kind: CompanyAssetKind) =>
    (
      await adminApi.delete<{ data: CompanyAssetRemoval }>(
        `/admin/company-profiles/${id}/assets/${kind}`,
      )
    ).data,
  removeUploadedCompanyAsset: async (assetId: string) =>
    (
      await adminApi.delete<{ data: UploadedCompanyAssetRemoval }>(
        `/admin/company-profile-assets/${assetId}`,
      )
    ).data,
  bankAccount: async (id: string) =>
    (await adminApi.get<{ data: BankAccountDetail }>(`/admin/bank-accounts/${id}`)).data,
  createBankAccount: async (payload: Record<string, unknown>) =>
    (await adminApi.post<{ data: BankAccountProfile }>('/admin/bank-accounts', payload)).data,
  updateBankAccount: async (id: string, payload: Record<string, unknown>) =>
    (await adminApi.patch<{ data: BankAccountProfile }>(`/admin/bank-accounts/${id}`, payload))
      .data,
  disableBankAccount: (id: string) =>
    adminApi.delete<{ data: { disabled: true } }>(`/admin/bank-accounts/${id}`),
};

export type { AdminFileDownload, PaginatedResponse };
