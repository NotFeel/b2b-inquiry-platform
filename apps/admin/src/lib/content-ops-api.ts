'use client';

import type {
  CredentialAdminDetail,
  CredentialAdminSummary,
  FactoryMediaAdminDetail,
  FactoryMediaAdminSummary,
  FactoryProcessStepAdminDetail,
  FactoryProcessStepAdminSummary,
  HomeSectionAdminDetail,
  PublishStatus,
} from '@b2b/contracts';
import { adminApi, uploadFile, type PaginatedResponse } from './admin-api';

export interface ContentTranslation {
  locale: string;
  title: string;
  description?: string | null;
}

export interface FactoryMediaTranslationPayload extends ContentTranslation {
  altText?: string | null;
}

export interface FactoryMediaPayload {
  mediaType: 'image' | 'video';
  assetId?: string | null;
  coverAssetId?: string | null;
  videoSourceType?: 'upload' | 'external' | null;
  videoUrl?: string | null;
  sourceNote?: string | null;
  adminNote?: string | null;
  placements: string[];
  sortOrder: number;
  status: PublishStatus;
  translations: FactoryMediaTranslationPayload[];
}

export interface FactoryProcessPayload {
  assetId?: string | null;
  sortOrder: number;
  status: PublishStatus;
  adminNote?: string | null;
  translations: ContentTranslation[];
}

export interface CredentialTranslationPayload {
  locale: string;
  name: string;
  description?: string | null;
  verificationLabel?: string | null;
}

export interface CredentialPayload {
  credentialTypeCode: string;
  issuer?: string | null;
  credentialNumber?: string | null;
  issuedAt?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  validityType: 'dated' | 'perpetual' | 'not_specified';
  showExpiredBadge: boolean;
  primaryAssetId?: string | null;
  additionalAssetIds: string[];
  verificationUrl?: string | null;
  placements: string[];
  sortOrder: number;
  status: PublishStatus;
  adminNote?: string | null;
  translations: CredentialTranslationPayload[];
}

export interface HomeSectionPayload {
  enabled: boolean;
  displayLimit: number;
  sortOrder: number;
  itemIds: string[];
  ctaUrl: string | null;
  adminNote: string | null;
  translations: {
    locale: string;
    title: string;
    description?: string | null;
    ctaLabel?: string | null;
  }[];
}

export interface ContentListParams {
  locale: string;
  page: number;
  pageSize: number;
  q?: string;
  publishStatus?: 'all' | PublishStatus;
  mediaType?: 'all' | 'image' | 'video';
  placement?: string;
  credentialType?: string;
  validityStatus?: 'all' | 'valid' | 'expiring' | 'expired' | 'no_expiry';
}

export const contentOpsApi = {
  factoryMedia: {
    list(params: ContentListParams): Promise<PaginatedResponse<FactoryMediaAdminSummary>> {
      return adminApi.list('/admin/content/factory-media', { ...params });
    },
    async get(id: string, locale: string): Promise<FactoryMediaAdminDetail> {
      return (
        await adminApi.get<{ data: FactoryMediaAdminDetail }>(
          `/admin/content/factory-media/${id}`,
          { locale },
        )
      ).data;
    },
    async create(payload: FactoryMediaPayload): Promise<FactoryMediaAdminDetail> {
      return (
        await adminApi.post<{ data: FactoryMediaAdminDetail }>(
          '/admin/content/factory-media',
          payload,
        )
      ).data;
    },
    async update(
      id: string,
      payload: Partial<FactoryMediaPayload>,
    ): Promise<FactoryMediaAdminDetail> {
      return (
        await adminApi.patch<{ data: FactoryMediaAdminDetail }>(
          `/admin/content/factory-media/${id}`,
          payload,
        )
      ).data;
    },
    setStatus(id: string, status: PublishStatus) {
      return adminApi.post(`/admin/content/factory-media/${id}/status`, { status });
    },
    remove(id: string) {
      return adminApi.delete(`/admin/content/factory-media/${id}`);
    },
  },
  factoryProcess: {
    list(params: ContentListParams): Promise<PaginatedResponse<FactoryProcessStepAdminSummary>> {
      return adminApi.list('/admin/content/factory-process', { ...params });
    },
    async get(id: string, locale: string): Promise<FactoryProcessStepAdminDetail> {
      return (
        await adminApi.get<{ data: FactoryProcessStepAdminDetail }>(
          `/admin/content/factory-process/${id}`,
          { locale },
        )
      ).data;
    },
    async create(payload: FactoryProcessPayload): Promise<FactoryProcessStepAdminDetail> {
      return (
        await adminApi.post<{ data: FactoryProcessStepAdminDetail }>(
          '/admin/content/factory-process',
          payload,
        )
      ).data;
    },
    async update(
      id: string,
      payload: Partial<FactoryProcessPayload>,
    ): Promise<FactoryProcessStepAdminDetail> {
      return (
        await adminApi.patch<{ data: FactoryProcessStepAdminDetail }>(
          `/admin/content/factory-process/${id}`,
          payload,
        )
      ).data;
    },
    setStatus(id: string, status: PublishStatus) {
      return adminApi.post(`/admin/content/factory-process/${id}/status`, { status });
    },
    remove(id: string) {
      return adminApi.delete(`/admin/content/factory-process/${id}`);
    },
  },
  credentials: {
    list(params: ContentListParams): Promise<PaginatedResponse<CredentialAdminSummary>> {
      return adminApi.list('/admin/content/credentials', { ...params });
    },
    async get(id: string, locale: string): Promise<CredentialAdminDetail> {
      return (
        await adminApi.get<{ data: CredentialAdminDetail }>(`/admin/content/credentials/${id}`, {
          locale,
        })
      ).data;
    },
    async create(payload: CredentialPayload): Promise<CredentialAdminDetail> {
      return (
        await adminApi.post<{ data: CredentialAdminDetail }>('/admin/content/credentials', payload)
      ).data;
    },
    async update(id: string, payload: Partial<CredentialPayload>): Promise<CredentialAdminDetail> {
      return (
        await adminApi.patch<{ data: CredentialAdminDetail }>(
          `/admin/content/credentials/${id}`,
          payload,
        )
      ).data;
    },
    setStatus(id: string, status: PublishStatus) {
      return adminApi.post(`/admin/content/credentials/${id}/status`, { status });
    },
    remove(id: string) {
      return adminApi.delete(`/admin/content/credentials/${id}`);
    },
  },
  homeSections: {
    async list(): Promise<HomeSectionAdminDetail[]> {
      return (
        await adminApi.get<{ data: HomeSectionAdminDetail[] }>('/admin/content/home-sections')
      ).data;
    },
    async update(code: string, payload: HomeSectionPayload): Promise<HomeSectionAdminDetail> {
      return (
        await adminApi.patch<{ data: HomeSectionAdminDetail }>(
          `/admin/content/home-sections/${encodeURIComponent(code)}`,
          payload,
        )
      ).data;
    },
  },
};

export function uploadContentAsset(file: File, purpose: string) {
  return uploadFile(file, purpose);
}
