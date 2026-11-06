'use client';

import type {
  QuotationExportConfig,
  QuotationExportPricingPreview,
  QuotationExportProductList,
  QuotationExportRequest,
  QuotationExportPreviewRequest,
  QuotationExportTemplateOption,
} from '@b2b/contracts';
import { adminApi, buildApiUrl } from './admin-api';

export type QuotationProductListQuery = {
  categoryId: string;
  includeDescendants: boolean;
  locale: string;
};

export type QuotationExportJob = {
  jobId: string;
  status: 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';
  errorCode: string | null;
  productCount: number;
  downloadReady: boolean;
  updatedAt: string;
};

export const quotationExportApi = {
  async config(locale: string): Promise<QuotationExportConfig> {
    const response = await adminApi.get<{ data: QuotationExportConfig }>(
      '/admin/quotation-export/config',
      { locale },
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

  async export(
    input: QuotationExportRequest,
  ): Promise<Pick<QuotationExportJob, 'jobId' | 'status' | 'productCount'>> {
    const response = await adminApi.post<{
      data: Pick<QuotationExportJob, 'jobId' | 'status' | 'productCount'>;
    }>('/admin/quotation-export/export', input);
    return response.data;
  },

  async job(jobId: string): Promise<QuotationExportJob> {
    const response = await adminApi.get<{ data: QuotationExportJob }>(
      `/admin/quotation-export/jobs/${encodeURIComponent(jobId)}`,
    );
    return response.data;
  },

  downloadUrl(jobId: string): string {
    // Let the browser stream the attachment directly. Fetching it as a Blob
    // would keep the entire generated workbook in Admin memory.
    return buildApiUrl(
      `/admin/quotation-export/jobs/${encodeURIComponent(jobId)}/download`,
      undefined,
      '',
    );
  },
};
