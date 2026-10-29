'use client';

import type {
  ProductImportCommitResult,
  ProductImportSettings,
  ProductImportValidationResult,
} from '@b2b/contracts';
import { AdminApiError, buildApiUrl } from './admin-api';

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: {
      code?: string;
      message?: string;
      requestId?: string;
      details?: Record<string, unknown>;
    };
  };
  if (!response.ok) {
    throw new AdminApiError(
      response.status,
      payload.error?.code ?? 'INTERNAL_ERROR',
      payload.error?.message ?? 'The request failed.',
      payload.error?.requestId,
      payload.error?.details,
    );
  }
  return payload.data as T;
}

export const productBulkImportApi = {
  templateUrl(): string {
    return buildApiUrl('/admin/products/bulk-import/template');
  },

  async validate(
    file: File,
    settings: ProductImportSettings,
  ): Promise<ProductImportValidationResult> {
    const form = new FormData();
    form.append('file', file);
    form.append('categoryId', settings.categoryId);
    form.append('publishStatus', settings.publishStatus);
    form.append('lifecycleStatus', settings.lifecycleStatus);
    form.append('tagIds', JSON.stringify(settings.tagIds));
    form.append('templateVersion', settings.templateVersion);
    const response = await fetch(buildApiUrl('/admin/products/bulk-import/validate'), {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      body: form,
    });
    return parseResponse<ProductImportValidationResult>(response);
  },

  async commit(validationId: string): Promise<ProductImportCommitResult> {
    const response = await fetch(buildApiUrl('/admin/products/bulk-import/commit'), {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ validationId }),
    });
    return parseResponse<ProductImportCommitResult>(response);
  },
};
