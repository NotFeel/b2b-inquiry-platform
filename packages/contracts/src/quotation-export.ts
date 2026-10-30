import type { QuotationExportCurrency } from './constants';

export interface QuotationExportConfig {
  currencies: QuotationExportCurrency[];
  defaultMarkupPercent: string;
  maxProducts: number;
  exchangeRateBase: 'CNY';
  rounding: 'CEIL_2';
}

/** Private quote-template option that is safe to expose to quotation exporters. */
export interface QuotationExportTemplateOption {
  id: string;
  name: string;
  version: number;
  fileName: string | null;
  sheetName: string | null;
  status: 'active';
}

export interface QuotationExportProduct {
  id: string;
  sku: string;
  englishName: string | null;
  categoryPath: string | null;
  thumbnailUrl: string | null;
  hasCost: boolean;
  /**
   * Internal CNY cost. Returned only to actors with `product.cost.read`;
   * otherwise this is null and no price is serialized (docs/13 §2).
   */
  costCny: string | null;
  hasOriginalImage: boolean;
  cartonQuantity: number | null;
  cartonDimensions: string | null;
  cartonGrossWeightKg: string | null;
  eligibilityCodes: string[];
}

export interface QuotationExportProductList {
  items: QuotationExportProduct[];
  totalCount: number;
  limitExceeded: boolean;
  maxProducts: number;
}

export interface QuotationExportValidationIssue {
  productId: string | null;
  sku: string | null;
  field: string;
  code: string;
  messageKey: string;
}

export interface QuotationExportPricingPreview {
  currencyCode: QuotationExportCurrency;
  markupPercent: string;
  exchangeRate: string;
  itemCount: number;
  items: {
    productId: string;
    sku: string;
    finalUnitPrice: string;
    currencyCode: QuotationExportCurrency;
  }[];
  warnings: QuotationExportValidationIssue[];
  errors: QuotationExportValidationIssue[];
}

export interface QuotationExportHeader {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  quotationTitle: string;
}

export interface QuotationExportPricing {
  markupPercent: string;
  currencyCode: QuotationExportCurrency;
  exchangeRate: string;
}

export interface QuotationExportSelection {
  categoryId: string;
  includeDescendants: boolean;
  productIds: string[];
}

export interface QuotationExportPreviewRequest
  extends QuotationExportSelection, QuotationExportPricing {}

export interface QuotationExportRequest extends QuotationExportSelection {
  /** Selected active product-quote template. The server reloads its structure. */
  templateId: string;
  header: QuotationExportHeader;
  pricing: QuotationExportPricing;
}

export interface QuotationExportDownload {
  blob: Blob;
  filename: string;
  requestId: string | null;
}
