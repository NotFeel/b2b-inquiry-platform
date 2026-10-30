import { beforeEach, describe, expect, it, vi } from 'vitest';

const { MockAdminApiError, mocks } = vi.hoisted(() => {
  class MockAdminApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
      readonly requestId?: string,
    ) {
      super(message);
    }
  }
  return {
    MockAdminApiError,
    mocks: {
      uploadFile: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      downloadAdminFileGet: vi.fn(),
    },
  };
});

vi.mock('./admin-api', () => ({
  AdminApiError: MockAdminApiError,
  adminApi: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
    delete: mocks.delete,
  },
  uploadFile: mocks.uploadFile,
  downloadAdminFileGet: mocks.downloadAdminFileGet,
}));

import {
  QUOTE_TEMPLATE_MAX_BYTES,
  quoteTemplatesApi,
  validateQuoteTemplateFile,
} from './quote-templates-api';

const summary = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'B2B quotation',
  templateType: 'product_quote',
  version: 1,
  status: 'draft',
  sheetName: 'Quotation',
  fieldMapping: { A: 'product.sku' },
  validationReport: { requiredFieldsPresent: true },
  fileAssetId: '22222222-2222-4222-8222-222222222222',
  fileName: 'B2B_Quotation_Template.xlsx',
  fileSizeBytes: '10240',
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
};

describe('quote template file validation', () => {
  it('accepts macro-free .xlsx workbooks within the upload limit', () => {
    expect(
      validateQuoteTemplateFile({ name: 'B2B_Quotation_Template.xlsx', size: 10_240 }),
    ).toBeNull();
  });

  it.each(['B2B_Quotation_Template.xls', 'B2B_Quotation_Template.xlsm', 'template.csv'])(
    'rejects unsupported file %s',
    (name) => {
      expect(validateQuoteTemplateFile({ name, size: 10_240 })).toBe('invalidFileType');
    },
  );

  it('rejects files above the API multipart limit', () => {
    expect(
      validateQuoteTemplateFile({
        name: 'B2B_Quotation_Template.xlsx',
        size: QUOTE_TEMPLATE_MAX_BYTES + 1,
      }),
    ).toBe('fileTooLarge');
  });
});

describe('quoteTemplatesApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads privately first and then registers without trusting browser field mappings', async () => {
    const phases: string[] = [];
    mocks.uploadFile.mockResolvedValue({ id: summary.fileAssetId });
    mocks.post.mockResolvedValue({ data: summary });
    const file = new File(['xlsx'], 'B2B_Quotation_Template.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const result = await quoteTemplatesApi.uploadAndRegister(
      file,
      { name: summary.name, templateType: 'product_quote' },
      (phase) => phases.push(phase),
    );

    expect(mocks.uploadFile).toHaveBeenCalledWith(file, 'quote-template');
    expect(mocks.post).toHaveBeenCalledWith('/admin/quote-templates', {
      name: summary.name,
      templateType: 'product_quote',
      fileAssetId: summary.fileAssetId,
    });
    expect(phases).toEqual(['uploading', 'registering']);
    expect(result).toEqual(summary);
  });

  it('does not upload an invalid file', async () => {
    const file = new File(['legacy'], 'B2B_Quotation_Template.xls');

    await expect(
      quoteTemplatesApi.uploadAndRegister(file, {
        name: summary.name,
        templateType: 'product_quote',
      }),
    ).rejects.toMatchObject({ code: 'QUOTE_TEMPLATE_INVALIDFILETYPE' });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('preserves a permission error from template registration', async () => {
    mocks.uploadFile.mockResolvedValue({ id: summary.fileAssetId });
    mocks.post.mockRejectedValue(new MockAdminApiError(403, 'FORBIDDEN', 'Forbidden', 'req-1'));
    const file = new File(['xlsx'], 'B2B_Quotation_Template.xlsx');

    await expect(
      quoteTemplatesApi.uploadAndRegister(file, {
        name: summary.name,
        templateType: 'product_quote',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', requestId: 'req-1' });
  });

  it('patches the activation status endpoint', async () => {
    mocks.patch.mockResolvedValue({ data: { ...summary, status: 'active' } });

    await quoteTemplatesApi.setStatus(summary.id, 'active');

    expect(mocks.patch).toHaveBeenCalledWith(`/admin/quote-templates/${summary.id}/status`, {
      status: 'active',
    });
  });

  it('downloads the private workbook through the authenticated GET endpoint', async () => {
    const download = {
      blob: new Blob(['xlsx']),
      filename: 'B2B_Quotation_Template.xlsx',
      requestId: 'request-file-1',
    };
    mocks.downloadAdminFileGet.mockResolvedValue(download);

    await expect(quoteTemplatesApi.download(summary.id, 'quote-template.xlsx')).resolves.toEqual(
      download,
    );
    expect(mocks.downloadAdminFileGet).toHaveBeenCalledWith(
      `/admin/quote-templates/${summary.id}/file`,
      'quote-template.xlsx',
    );
  });

  it('loads the bounded read-only preview DTO', async () => {
    const preview = {
      templateId: summary.id,
      name: summary.name,
      version: summary.version,
      sheetName: 'Quotation',
      rowCount: 0,
      columnCount: 0,
      truncated: false,
      merges: [],
      columns: [],
      rows: [],
      images: [],
    };
    mocks.get.mockResolvedValue({ data: preview });

    await expect(quoteTemplatesApi.preview(summary.id)).resolves.toEqual(preview);
    expect(mocks.get).toHaveBeenCalledWith(`/admin/quote-templates/${summary.id}/preview`);
  });

  it('requests retryable physical deletion of the version', async () => {
    mocks.delete.mockResolvedValue({ status: 'deletion_pending' });

    await expect(quoteTemplatesApi.remove(summary.id)).resolves.toBe('deletion_pending');
    expect(mocks.delete).toHaveBeenCalledWith(`/admin/quote-templates/${summary.id}`);
  });
});
