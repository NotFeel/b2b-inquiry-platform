import type { DocumentTemplateConfig, DocumentTemplateSummary } from './commercial-documents-api';

export interface DocumentTemplateMeta {
  name: string;
  description: string;
  locale: string;
  paperSize: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  isDefault: boolean;
}

export interface DocumentTemplateListFilters {
  q: string;
  type: 'all' | 'PI' | 'CI';
  status: 'all' | 'DRAFT' | 'ACTIVE' | 'DISABLED';
  locale: '' | 'en-US' | 'zh-CN';
}

export function documentTemplateListQuery(
  filters: DocumentTemplateListFilters,
  page: number,
  pageSize: number,
): Record<string, string | number> {
  return {
    page,
    pageSize,
    type: filters.type,
    status: filters.status,
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.locale ? { locale: filters.locale } : {}),
  };
}

export function documentTemplateSignature(
  meta: DocumentTemplateMeta,
  config: DocumentTemplateConfig,
): string {
  return JSON.stringify({ meta, config });
}

export function isDocumentTemplateDeletable(
  template: Pick<DocumentTemplateSummary, 'canDelete'>,
): boolean {
  return template.canDelete;
}
