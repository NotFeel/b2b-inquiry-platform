import { describe, expect, it } from 'vitest';
import type { DocumentTemplateConfig } from './commercial-documents-api';
import {
  documentTemplateListQuery,
  documentTemplateSignature,
  isDocumentTemplateDeletable,
} from './document-template-page';

const config = {
  schemaVersion: 1,
  page: {
    size: 'A4',
    orientation: 'portrait',
    marginMm: { top: 12, right: 12, bottom: 14, left: 12 },
  },
  theme: {
    primaryColor: '#111827',
    accentColor: '#2563eb',
    fontFamily: 'Helvetica',
    fontSizePt: 10,
  },
  header: {
    title: 'COMMERCIAL INVOICE',
    showLogo: true,
    showStamp: true,
    showDocumentType: true,
  },
  sections: [],
  itemColumns: [
    { key: 'items.description', visible: true, required: false, label: 'Description', width: 28 },
    { key: 'items.amount', visible: true, required: false, label: 'Amount', width: 12 },
  ],
  footer: { showText: true, showPageNumbers: true },
  terms: {
    showPaymentNotice: true,
    showShipmentNotice: true,
    showAuthenticityDeclaration: true,
  },
  notes: { visible: true, title: 'Notes' },
} as DocumentTemplateConfig;

describe('document template page helpers', () => {
  it('omits empty optional list filters and bounds through the API contract', () => {
    expect(
      documentTemplateListQuery(
        { q: '  invoice  ', type: 'CI', status: 'DRAFT', locale: '' },
        2,
        20,
      ),
    ).toEqual({
      page: 2,
      pageSize: 20,
      type: 'CI',
      status: 'DRAFT',
      q: 'invoice',
    });
    expect(
      documentTemplateListQuery({ q: '', type: 'all', status: 'all', locale: 'zh-CN' }, 1, 50),
    ).toMatchObject({ locale: 'zh-CN', page: 1, pageSize: 50 });
  });

  it('uses the server eligibility flag for template deletion', () => {
    expect(isDocumentTemplateDeletable({ canDelete: true })).toBe(true);
    expect(isDocumentTemplateDeletable({ canDelete: false })).toBe(false);
  });

  it('changes the signature when a field visibility setting changes', () => {
    const meta = {
      name: 'CI template',
      description: '',
      locale: 'en-US',
      paperSize: 'A4' as const,
      orientation: 'portrait' as const,
      isDefault: false,
    };
    const initial = documentTemplateSignature(meta, config);
    const changed = documentTemplateSignature(meta, {
      ...config,
      notes: { ...config.notes, visible: false },
    });
    expect(changed).not.toBe(initial);
  });
});
