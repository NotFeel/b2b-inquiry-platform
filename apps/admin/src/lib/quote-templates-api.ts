'use client';

import type { QuoteTemplatePreview, QuoteTemplateSummary, QuoteTemplateType } from '@b2b/contracts';
import {
  AdminApiError,
  adminApi,
  downloadAdminFileGet,
  uploadFile,
  type AdminFileDownload,
} from './admin-api';

export type QuoteTemplateStatus = 'draft' | 'active' | 'disabled';
export type QuoteTemplateUploadPhase = 'uploading' | 'registering';

export interface QuoteTemplateCreateInput {
  name: string;
  templateType: QuoteTemplateType;
  fileAssetId: string;
}

/** Mirrors the API multipart limit so an invalid file is rejected before upload. */
export const QUOTE_TEMPLATE_MAX_BYTES = 10 * 1024 * 1024;

export function validateQuoteTemplateFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!file.name.toLowerCase().endsWith('.xlsx')) return 'invalidFileType';
  if (file.size > QUOTE_TEMPLATE_MAX_BYTES) return 'fileTooLarge';
  return null;
}

export const quoteTemplatesApi = {
  async list(): Promise<QuoteTemplateSummary[]> {
    const response = await adminApi.get<{ data: QuoteTemplateSummary[] }>('/admin/quote-templates');
    return response.data;
  },

  async create(input: QuoteTemplateCreateInput): Promise<QuoteTemplateSummary> {
    const response = await adminApi.post<{ data: QuoteTemplateSummary }>(
      '/admin/quote-templates',
      input,
    );
    return response.data;
  },

  async setStatus(id: string, status: QuoteTemplateStatus): Promise<QuoteTemplateSummary> {
    const response = await adminApi.patch<{ data: QuoteTemplateSummary }>(
      `/admin/quote-templates/${id}/status`,
      { status },
    );
    return response.data;
  },

  download(id: string, fallbackFilename = 'quote-template.xlsx'): Promise<AdminFileDownload> {
    return downloadAdminFileGet(`/admin/quote-templates/${id}/file`, fallbackFilename);
  },

  async preview(id: string): Promise<QuoteTemplatePreview> {
    const response = await adminApi.get<{ data: QuoteTemplatePreview }>(
      `/admin/quote-templates/${id}/preview`,
    );
    return response.data;
  },

  async remove(id: string): Promise<'deletion_pending'> {
    const response = await adminApi.delete<{ status: 'deletion_pending' }>(
      `/admin/quote-templates/${id}`,
    );
    return response.status;
  },

  /**
   * Uploads the private workbook first, then registers the immutable version.
   * Structural fields are intentionally omitted so the API inspects the sheet,
   * header row and item start row instead of trusting browser-side values.
   */
  async uploadAndRegister(
    file: File,
    input: Omit<QuoteTemplateCreateInput, 'fileAssetId'>,
    onPhase?: (phase: QuoteTemplateUploadPhase) => void,
  ): Promise<QuoteTemplateSummary> {
    const validationError = validateQuoteTemplateFile(file);
    if (validationError) {
      throw new AdminApiError(
        400,
        `QUOTE_TEMPLATE_${validationError.toUpperCase()}`,
        validationError,
      );
    }

    onPhase?.('uploading');
    const asset = await uploadFile(file, 'quote-template');
    onPhase?.('registering');
    return this.create({ ...input, fileAssetId: asset.id });
  },
};
