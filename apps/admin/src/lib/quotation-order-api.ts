'use client';

import { adminApi, downloadAdminFilePost, type AdminFileDownload } from './admin-api';

const pendingIdempotency = new Map<string, { signature: string; key: string }>();

async function postIdempotently<T>(
  scope: string,
  path: string,
  input: CalculatorInput,
): Promise<T> {
  const signature = JSON.stringify(input);
  const cached = pendingIdempotency.get(scope);
  const key = cached?.signature === signature ? cached.key : globalThis.crypto.randomUUID();
  pendingIdempotency.set(scope, { signature, key });
  const response = await adminApi.postWithHeaders<{ data: T }>(path, input, {
    'Idempotency-Key': key,
  });
  if (pendingIdempotency.get(scope)?.key === key) pendingIdempotency.delete(scope);
  // Rejected calls leave the key cached, so a retry after a timeout or lost
  // response returns the already persisted result. A changed body gets a new key.
  return response.data;
}

export type QuotationConfig = {
  currencies: { code: string; symbol: string | null; label: string }[];
  volumetricDivisors: { id: string; code: string; value: string | null; label: string }[];
  feeTypes: { code: string; label: string }[];
  publishStatuses: { code: string; label: string }[];
  productLifecycles: { code: string; label: string }[];
  roundingMode: string;
};

export type CalculatorProduct = {
  id: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  imageAlt: string;
  publishStatus: 'draft' | 'published' | 'unpublished';
  lifecycleStatus: string;
  costCny: string | null;
  packaging: {
    cartonLengthCm: string | null;
    cartonWidthCm: string | null;
    cartonHeightCm: string | null;
    cartonGrossWeightKg: string | null;
    unitsPerCarton: number | null;
  };
};

export type CalculatorInput = {
  customerId?: string | null;
  title: string;
  customer: {
    companyName: string;
    contactName: string;
    phoneE164: string;
    email?: string | null;
    countryCode?: string | null;
    customerType?: 'COMPANY' | 'INDIVIDUAL';
    legalCompanyName?: string;
    taxId?: string;
    website?: string;
    preferredLanguage?: string;
    billingAddress?: null | {
      recipient?: string;
      companyName?: string;
      phoneE164?: string;
      countryCode: string;
      region: string;
      city: string;
      postalCode: string;
      line1: string;
      line2: string;
    };
    shippingAddress?: null | {
      recipient: string;
      companyName?: string;
      phoneE164?: string;
      countryCode: string;
      region: string;
      city: string;
      postalCode: string;
      line1: string;
      line2: string;
    };
  };
  buyerReference?: string;
  trade?: {
    incotermCode?: string | null;
    namedPlace?: string;
    paymentTerms?: string;
  };
  orderDate?: string | null;
  currencyCode: string;
  exchangeRate: string;
  exchangeRateDate: string;
  freightBillingMethod: 'CBM' | 'KG';
  freightCurrencyCode: 'CNY';
  cbmRatePerCbm: string;
  kgRatePerKg: string;
  volumetricDivisorItemId: string;
  deliveryFeeCny: string;
  items: {
    productId: string;
    markupPercent: string;
    cartonCount: number;
    cartonLengthCm: string | null;
    cartonWidthCm: string | null;
    cartonHeightCm: string | null;
    cartonGrossWeightKg: string | null;
  }[];
  fees: { feeTypeCode: string; name: string; amountCny: string; notes?: string | null }[];
};

export type CalculationResult = {
  items: {
    lineNo: number;
    sku: string;
    productName: string;
    cartonCount: number | null;
    unitsPerCarton: number | null;
    costCny?: string;
    quantity: string;
    unitSalePriceCny: string;
    unitSalePriceForeign: string;
    lineAmountCny: string;
    totalVolumeWeightKg: string;
    totalGrossWeightKg: string;
    cartonVolumeCbm: string;
    cartonVolumeWeightKg: string;
    totalCbm: string;
    allocatedFreightCny?: string;
    allocatedFreightForeign?: string;
    lineAmountForeign: string;
  }[];
  fees: {
    typeCode: string;
    name: string;
    amountCny: string;
    amountForeign: string;
    isFreight: boolean;
  }[];
  totals: {
    subtotalCny: string;
    freightCny: string;
    deliveryFeeCny: string;
    otherFeesCny: string;
    totalAmountCny: string;
    totalAmountForeign: string;
    volumeWeightKg: string;
    grossWeightKg: string;
    chargeableWeightKg: string;
    orderTotalCbm: string;
    selectedFreightAmount: string;
  };
  freight: {
    freightBillingMethod: 'CBM' | 'KG';
    freightCurrencyCode: string;
    cbmRatePerCbm: string;
    orderTotalCbm: string;
    cbmFreightAmount: string;
    cbmFreightAmountForeign: string;
    kgRatePerKg: string;
    volumetricDivisor: number;
    orderTotalVolumeWeightKg: string;
    orderTotalGrossWeightKg: string;
    chargeableWeightKg: string;
    kgChargeableBasis: 'VOLUME_WEIGHT' | 'GROSS_WEIGHT';
    kgFreightAmount: string;
    kgFreightAmountForeign: string;
    selectedFreightAmount: string;
    selectedFreightAmountForeign: string;
    allocationSnapshot?: {
      lineNo: number;
      basis: string;
      allocatedFreightAmount: string;
      allocatedFreightCny: string;
      allocatedFreightForeign: string;
    }[];
  };
};

export type CalculatorExcelTemplateOption = {
  id: string;
  name: string;
  version: number;
};

export type QuotationDraftEditData = {
  quotation: {
    id: string;
    quotationNo: string;
    title: string;
    revision: number;
  };
  calculation: CalculatorInput;
  products: CalculatorProduct[];
};

export function saveQuotationExcelDownload(download: AdminFileDownload): void {
  const url = URL.createObjectURL(download.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = download.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const quotationOrderApi = {
  saveQuotationExcelDownload: (download: AdminFileDownload) => saveQuotationExcelDownload(download),
  calculatorExcelTemplates: async () =>
    (
      await adminApi.get<{ data: CalculatorExcelTemplateOption[] }>(
        '/admin/quotation-calculator/excel-templates',
      )
    ).data,
  quotationExcelTemplates: async () =>
    (
      await adminApi.get<{ data: CalculatorExcelTemplateOption[] }>(
        '/admin/quotations/excel-templates',
      )
    ).data,
  orderExcelTemplates: async () =>
    (await adminApi.get<{ data: CalculatorExcelTemplateOption[] }>('/admin/orders/excel-templates'))
      .data,
  exportCalculatorExcel: (templateId: string, calculation: CalculatorInput) =>
    downloadAdminFilePost('/admin/quotation-calculator/export-excel', {
      templateId,
      calculation,
    }),
  exportQuotationExcel: (id: string, templateId: string) =>
    downloadAdminFilePost(`/admin/quotations/${id}/export-excel`, { templateId }),
  exportOrderExcel: (id: string, templateId: string) =>
    downloadAdminFilePost(`/admin/orders/${id}/export-excel`, { templateId }),
  config: async (locale: string) =>
    (
      await adminApi.get<{ data: QuotationConfig }>('/admin/quotation-calculator/config', {
        locale,
      })
    ).data,
  products: async (
    locale: string,
    q?: string,
    categoryId?: string | null,
    publishStatus?: 'published' | 'unpublished',
  ) =>
    (
      await adminApi.get<{ data: CalculatorProduct[] }>('/admin/quotation-calculator/products', {
        locale,
        ...(q ? { q } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(publishStatus ? { publishStatus } : {}),
      })
    ).data,
  preview: async (input: CalculatorInput) =>
    (await adminApi.post<{ data: CalculationResult }>('/admin/quotation-calculator/preview', input))
      .data,
  saveDraft: async (input: CalculatorInput) =>
    postIdempotently<{ id: string; quotationNo: string }>(
      'quotation-draft',
      '/admin/quotations',
      input,
    ),
  quotationEditData: async (id: string) =>
    (await adminApi.get<{ data: QuotationDraftEditData }>(`/admin/quotations/${id}/edit-data`))
      .data,
  updateDraft: async (id: string, input: CalculatorInput) =>
    (
      await adminApi.patch<{ data: { id: string; quotationNo: string; revision: number } }>(
        `/admin/quotations/${id}`,
        input,
      )
    ).data,
  deleteQuotation: async (id: string) =>
    (await adminApi.delete<{ data: { id: string; deleted: true } }>(`/admin/quotations/${id}`))
      .data,
  createOrder: async (input: CalculatorInput) =>
    postIdempotently<{ id: string; orderNo: string; contractNo: string }>(
      'direct-order',
      '/admin/orders',
      input,
    ),
  convert: async (id: string) =>
    (
      await adminApi.post<{ data: { id: string; orderNo: string; contractNo: string } }>(
        `/admin/quotations/${id}/convert-to-order`,
      )
    ).data,
  quotations: () =>
    adminApi.list<{
      id: string;
      quotationNo: string;
      title: string;
      status: string;
      currencyCode: string;
      totalAmountCny: string;
      totalAmountForeign: string;
      createdAt: string;
    }>('/admin/quotations'),
  orders: () =>
    adminApi.list<{
      id: string;
      orderNo: string;
      status: string;
      currencyCode: string;
      totalAmountCny: string;
      totalAmountForeign: string;
      orderDate: string;
    }>('/admin/orders'),
  customers: () =>
    adminApi.list<{
      id: string;
      phoneE164: string;
      displayName: string | null;
      legalName: string | null;
      contactName: string | null;
      email: string | null;
      taxId: string | null;
      customerType: string;
      preferredLanguage: string;
      countryCode: string | null;
      billingAddress: Record<string, unknown> | null;
      defaultShippingAddress: Record<string, unknown> | null;
    }>('/admin/customers', { page: 1, pageSize: 100 }),
};
