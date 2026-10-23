'use client';

import type {
  FileOperationSummary,
  MediaStagingResult,
  Paginated,
  ProductAdminDetail,
  ProductAdminSummary,
  ProductImageAttachResult,
  ProductImageSummary,
  ProductSlugSuggestion,
  PublishStatus,
} from '@b2b/contracts';
import { AdminApiError, adminApi, buildApiUrl, uploadFileDirect } from './admin-api';

// Typed wrappers over the product endpoints (docs/24 §6).
//
// Machine values only cross this boundary: ids, codes, decimal strings and
// booleans. Gallery state (`READY` / `DELETE_PENDING` / `DELETE_FAILED`) and the
// delete operations come from the server, so the UI never has to guess whether a
// stored object still exists.

export type ImageFilter = 'all' | 'with' | 'without';

export interface ProductListParams {
  q?: string;
  categoryId?: string;
  includeDescendants?: boolean;
  publishStatus?: PublishStatus;
  lifecycleStatus?: string;
  isFeatured?: boolean;
  isNew?: boolean;
  tagId?: string;
  hasImages?: ImageFilter;
  sortBy?: 'updated_at' | 'created_at' | 'sku' | 'name' | 'sort_order';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ProductTranslationPayload {
  locale: string;
  name: string;
  description: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

/** Product master data. Images are deliberately absent: they have their own API. */
export interface ProductWritePayload {
  slug: string;
  categoryId: string;
  publishStatus: PublishStatus;
  lifecycleStatus: string;
  sortOrder: number;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  weightGrams: number | null;
  packaging: string | null;
  cartonLengthCm: number | null;
  cartonWidthCm: number | null;
  cartonHeightCm: number | null;
  cartonWeightKg: string | null;
  cartonQuantity: number | null;
  tagIds: string[];
  translations: ProductTranslationPayload[];
  /** Only sent when the actor holds `product.cost.update`. */
  priceCny?: string | null;
}

export interface CreateProductPayload extends ProductWritePayload {
  sku: string;
}

export interface ProductDeleteAccepted {
  accepted: true;
  productId: string;
  operationId: string;
  imageOperations: number;
}

export interface ProductImageDeleteAccepted {
  operationId: string;
  status: 'PENDING';
  imageId: string;
  messageKey: string;
}

export const productsApi = {
  async suggestSlug(input: {
    name: string;
    strategy: 'name' | 'name-random';
    excludeProductId?: string | null;
  }): Promise<ProductSlugSuggestion> {
    const response = await adminApi.post<{ data: ProductSlugSuggestion }>(
      '/admin/products/slug-suggestion',
      input,
    );
    return response.data;
  },

  list(params: ProductListParams): Promise<Paginated<ProductAdminSummary>> {
    return adminApi.get<Paginated<ProductAdminSummary>>('/admin/products', {
      ...(params.q ? { q: params.q } : {}),
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.categoryId && params.includeDescendants === false
        ? { includeDescendants: 'false' }
        : {}),
      ...(params.publishStatus ? { publishStatus: params.publishStatus } : {}),
      ...(params.lifecycleStatus ? { lifecycleStatus: params.lifecycleStatus } : {}),
      ...(params.isFeatured !== undefined ? { isFeatured: params.isFeatured } : {}),
      ...(params.isNew !== undefined ? { isNew: params.isNew } : {}),
      ...(params.tagId ? { tagId: params.tagId } : {}),
      ...(params.hasImages && params.hasImages !== 'all' ? { hasImages: params.hasImages } : {}),
      sortBy: params.sortBy ?? 'updated_at',
      sortOrder: params.sortOrder ?? 'desc',
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    });
  },

  async detail(id: string): Promise<ProductAdminDetail> {
    const response = await adminApi.get<{ data: ProductAdminDetail }>(`/admin/products/${id}`);
    return response.data;
  },

  async create(payload: CreateProductPayload): Promise<{ id: string; sku: string; slug: string }> {
    const response = await adminApi.post<{ data: { id: string; sku: string; slug: string } }>(
      '/admin/products',
      payload,
    );
    return response.data;
  },

  async update(
    id: string,
    payload: ProductWritePayload,
  ): Promise<{ id: string; slug: string; publishStatus: string }> {
    const response = await adminApi.patch<{
      data: { id: string; slug: string; publishStatus: string };
    }>(`/admin/products/${id}`, payload);
    return response.data;
  },

  async setPublishStatus(
    id: string,
    status: PublishStatus,
  ): Promise<{ id: string; publishStatus: string }> {
    const response = await adminApi.post<{ data: { id: string; publishStatus: string } }>(
      `/admin/products/${id}/publish`,
      { publishStatus: status },
    );
    return response.data;
  },

  async remove(id: string): Promise<ProductDeleteAccepted> {
    const response = await adminApi.delete<{ data: ProductDeleteAccepted }>(
      `/admin/products/${id}`,
    );
    return response.data;
  },

  async attachImages(
    productId: string,
    assets: { fileAssetId: string; altText?: string | null; isCover?: boolean }[],
  ): Promise<ProductImageAttachResult> {
    const response = await adminApi.post<{ data: ProductImageAttachResult }>(
      `/admin/products/${productId}/images`,
      { assets },
    );
    return response.data;
  },

  async reorderImages(productId: string, imageIds: string[]): Promise<ProductImageAttachResult> {
    const response = await adminApi.patch<{ data: ProductImageAttachResult }>(
      `/admin/products/${productId}/images/order`,
      { imageIds },
    );
    return response.data;
  },

  async setCover(productId: string, imageId: string): Promise<ProductImageAttachResult> {
    const response = await adminApi.put<{ data: ProductImageAttachResult }>(
      `/admin/products/${productId}/images/${imageId}/cover`,
    );
    return response.data;
  },

  async updateImageAlt(
    productId: string,
    imageId: string,
    altText: string | null,
  ): Promise<ProductImageSummary> {
    const response = await adminApi.patch<{ data: ProductImageSummary }>(
      `/admin/products/${productId}/images/${imageId}`,
      { altText },
    );
    return response.data;
  },

  async deleteImage(productId: string, imageId: string): Promise<ProductImageDeleteAccepted> {
    const response = await adminApi.delete<{ data: ProductImageDeleteAccepted }>(
      `/admin/products/${productId}/images/${imageId}`,
    );
    return response.data;
  },

  async fileOperation(operationId: string): Promise<FileOperationSummary> {
    const response = await adminApi.get<{ data: FileOperationSummary }>(
      `/admin/file-operations/${operationId}`,
    );
    return response.data;
  },

  async retryFileOperation(operationId: string): Promise<FileOperationSummary> {
    const response = await adminApi.post<{ data: FileOperationSummary }>(
      `/admin/file-operations/${operationId}/retry`,
    );
    return response.data;
  },
};

/**
 * Uploads one image to the staging area.
 *
 * The endpoint fixes the upload purpose server-side, so this call can only ever
 * create a product image. The response carries the validated dimensions and a
 * preview URL; the asset becomes part of a product only when the gallery is
 * attached explicitly.
 */
export async function uploadProductImage(file: File): Promise<MediaStagingResult> {
  try {
    const direct = await uploadFileDirect(file, 'product-image', {
      initiate: '/admin/media/staging/presign',
      confirm: (id) => `/admin/media/staging/${id}/confirm`,
      status: (id) => `/admin/media/staging/${id}`,
    });
    return getProductImageStaging(direct.id);
  } catch (error) {
    if (!(error instanceof AdminApiError) || error.code !== 'UPLOAD_DIRECT_UNAVAILABLE') {
      throw error;
    }
  }

  const form = new FormData();
  form.append('file', file);
  const response = await fetch(buildApiUrl('/admin/media/staging'), {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const payload = (await response.json().catch(() => ({}))) as
    | { data: MediaStagingResult }
    | { error?: { code?: string; message?: string; requestId?: string } };
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; requestId?: string } })
      .error;
    throw new AdminApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'The upload failed.',
      error?.requestId,
    );
  }
  return (payload as { data: MediaStagingResult }).data;
}

/** Re-reads the authoritative Sharp processing state after a staging upload. */
export async function getProductImageStaging(fileAssetId: string): Promise<MediaStagingResult> {
  const response = await adminApi.get<{ data: MediaStagingResult }>(
    `/admin/media/staging/${fileAssetId}`,
  );
  return response.data;
}
