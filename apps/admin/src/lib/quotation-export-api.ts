'use client';

import type {
  QuotationExportConfig,
  QuotationExportPricingPreview,
  QuotationExportProductList,
  QuotationExportRequest,
  QuotationExportPreviewRequest,
  QuotationExportTemplateOption,
} from '@b2b/contracts';
import { adminApi, downloadAdminFilePost, type AdminFileDownload } from './admin-api';

export type QuotationProductListQuery = {
  categoryId: string;
  includeDescendants: boolean;
  locale: string;
};

export const quotationExportApi = {
  async config(): Promise<QuotationExportConfig> {
    const response = await adminApi.get<{ data: QuotationExportConfig }>(
      '/admin/quotation-export/config',
    );
    return response.data;
  },

  async templates(): Promise<QuotationExportTemplateOption[]> {
    const response = await adminApi.get<{ data: QuotationExportTemplateOption[] }>(
      '/admin/quotation-export/templates',
    );
    return response.data;
  },

  async products(query: QuotationProductListQuery): Promise<QuotationExportProductList> {
    const response = await adminApi.get<{ data: QuotationExportProductList }>(
      '/admin/quotation-export/products',
      {
        categoryId: query.categoryId,
        includeDescendants: query.includeDescendants,
        locale: query.locale,
      },
    );
    return response.data;
  },

  async preview(input: QuotationExportPreviewRequest): Promise<QuotationExportPricingPreview> {
    const response = await adminApi.post<{ data: QuotationExportPricingPreview }>(
      '/admin/quotation-export/preview',
      input,
    );
    return response.data;
  },

  export(input: QuotationExportRequest): Promise<AdminFileDownload> {
    return downloadAdminFilePost('/admin/quotation-export/export', input);
  },
};
