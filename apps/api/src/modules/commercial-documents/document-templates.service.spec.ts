import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTemplateConfig } from '@b2b/commercial-documents';
import { ERROR_CODES } from '@b2b/contracts';
import type { AuditService } from '../../common/services/audit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { DocumentTemplatesService } from './document-templates.service';

const TEMPLATE_ID = 'd4f7e4d6-2db7-4f6b-ad12-1a2b3c4d5e6f';
const VERSION_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    code: 'ci-template',
    name: 'CI template',
    description: null,
    documentType: 'CI',
    locale: 'en-US',
    paperSize: 'A4',
    orientation: 'portrait',
    status: 'ACTIVE',
    isDefault: true,
    draftConfig: createDefaultTemplateConfig('CI'),
    currentVersionId: VERSION_ID,
    createdById: null,
    updatedById: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    versions: [
      {
        id: VERSION_ID,
        templateId: TEMPLATE_ID,
        version: 1,
        status: 'PUBLISHED',
        config: createDefaultTemplateConfig('CI'),
        checksum: 'a'.repeat(64),
        createdById: null,
        publishedAt: new Date('2026-11-01T00:00:00.000Z'),
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
      },
    ],
    ...overrides,
  };
}

describe('DocumentTemplatesService.resolveVersion', () => {
  const findUnique = vi.fn();
  let service: DocumentTemplatesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DocumentTemplatesService(
      { documentTemplateVersion: { findUnique } } as unknown as PrismaService,
      { record: vi.fn() } as unknown as AuditService,
    );
  });

  it('returns the published version and parsed config', async () => {
    findUnique.mockResolvedValue({
      ...template().versions[0],
      template: template(),
    });
    const resolved = await service.resolveVersion(VERSION_ID, 'CI');
    expect(resolved.version.version).toBe(1);
    expect(resolved.config.itemColumns.length).toBeGreaterThan(0);
  });

  it('rejects an unpublished template version', async () => {
    findUnique.mockResolvedValue({
      ...template().versions[0],
      status: 'DRAFT',
      template: template(),
    });
    await expect(service.resolveVersion(VERSION_ID, 'CI')).rejects.toMatchObject({
      code: ERROR_CODES.documentTemplateNotPublished,
    });
  });

  it('rejects a template from the other document type', async () => {
    findUnique.mockResolvedValue({
      ...template().versions[0],
      template: template({ documentType: 'PI' }),
    });
    await expect(service.resolveVersion(VERSION_ID, 'CI')).rejects.toMatchObject({
      code: ERROR_CODES.documentTemplateTypeMismatch,
    });
  });
});

describe('DocumentTemplatesService.activeOptions', () => {
  it('returns the selected version config so the editor can render its visible fields immediately', async () => {
    const row = template();
    row.versions[0]!.config.sections.find((section) => section.key === 'notifyParty')!.visible =
      false;
    const service = new DocumentTemplatesService(
      {
        documentTemplate: { findMany: vi.fn(async () => [row]) },
      } as unknown as PrismaService,
      { record: vi.fn() } as unknown as AuditService,
    );

    const options = await service.activeOptions('CI');

    expect(options[0]?.versionId).toBe(VERSION_ID);
    expect(
      options[0]?.config.sections.find((section) => section.key === 'notifyParty')?.visible,
    ).toBe(false);
    expect(options[0]?.hasUnpublishedChanges).toBe(true);
  });

  it('reports when the draft matches the published configuration', async () => {
    const row = template();
    const service = new DocumentTemplatesService(
      {
        documentTemplate: { findMany: vi.fn(async () => [row]) },
      } as unknown as PrismaService,
      { record: vi.fn() } as unknown as AuditService,
    );

    const options = await service.activeOptions('CI');

    expect(options[0]?.hasUnpublishedChanges).toBe(false);
  });
});

describe('DocumentTemplatesService.publish', () => {
  it('creates the next immutable version and points the template at it', async () => {
    const templateRow = template();
    const nextVersion = {
      ...templateRow.versions[0],
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      version: 2,
    };
    const create = vi.fn(async () => nextVersion);
    const update = vi.fn(async () => templateRow);
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const findUnique = vi.fn(async () => templateRow);
    const prisma = {
      documentTemplate: { findUnique, update },
      documentTemplateVersion: { create },
      $transaction: async (callback: (tx: unknown) => unknown) =>
        callback({
          documentTemplateVersion: { create },
          documentTemplate: { update, updateMany },
        }),
    } as unknown as PrismaService;
    const audit = { record: vi.fn() };
    const service = new DocumentTemplatesService(prisma, audit as unknown as AuditService);

    await service.publish(TEMPLATE_ID, 'actor-1', 'request-1');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ templateId: TEMPLATE_ID, version: 2, status: 'PUBLISHED' }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentVersionId: nextVersion.id,
          status: 'ACTIVE',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document_template.published' }),
    );
  });
});

describe('DocumentTemplatesService.remove', () => {
  function serviceFor(
    row: Record<string, unknown> | null,
    options: { versionIds?: string[]; renderJobCount?: number } = {},
  ) {
    const findUnique = vi.fn(async () => row);
    const findManyVersions = vi.fn(async () =>
      (options.versionIds ?? []).map((id) => ({ id })),
    );
    const renderJobCount = vi.fn(async () => options.renderJobCount ?? 0);
    const deleteVersions = vi.fn(async () => ({ count: options.versionIds?.length ?? 0 }));
    const deleteFn = vi.fn();
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        documentTemplate: { findUnique, delete: deleteFn },
        documentTemplateVersion: { findMany: findManyVersions, deleteMany: deleteVersions },
        documentRenderJob: { count: renderJobCount },
      }),
    );
    const audit = { record: vi.fn() };
    const service = new DocumentTemplatesService(
      { $transaction: transaction } as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    return { service, findUnique, deleteFn, deleteVersions, audit };
  }

  it('deletes an unused draft and audits only safe metadata', async () => {
    const { service, deleteFn, audit } = serviceFor({
      id: TEMPLATE_ID,
      code: 'ci-draft',
      name: 'Draft template',
      documentType: 'CI',
      locale: 'en-US',
      status: 'DRAFT',
      isDefault: false,
      _count: { versions: 0, documents: 0 },
    });

    await expect(service.remove(TEMPLATE_ID, 'actor-1', 'request-1')).resolves.toEqual({
      deleted: true,
    });
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: TEMPLATE_ID } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document_template.deleted',
        metadata: expect.objectContaining({
          templateId: TEMPLATE_ID,
          code: 'ci-draft',
          documentType: 'CI',
          locale: 'en-US',
        }),
      }),
    );
  });

  it('deletes a disabled, non-default template with its unreferenced version history', async () => {
    const { service, deleteFn, deleteVersions, audit } = serviceFor(
      {
        id: TEMPLATE_ID,
        code: 'ci-disabled',
        name: 'Old CI template',
        documentType: 'CI',
        locale: 'en-US',
        status: 'DISABLED',
        isDefault: false,
        _count: { versions: 1, documents: 0 },
      },
      { versionIds: [VERSION_ID] },
    );

    await expect(service.remove(TEMPLATE_ID, 'actor-1', 'request-1')).resolves.toEqual({
      deleted: true,
    });
    expect(deleteVersions).toHaveBeenCalledWith({ where: { templateId: TEMPLATE_ID } });
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: TEMPLATE_ID } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document_template.deleted',
        metadata: expect.objectContaining({
          statusBeforeDelete: 'DISABLED',
          versionCount: 1,
        }),
      }),
    );
  });

  it.each([
    ['active', { status: 'ACTIVE', isDefault: false, _count: { versions: 0, documents: 0 } }],
    ['default', { status: 'DRAFT', isDefault: true, _count: { versions: 0, documents: 0 } }],
  ])('refuses deletion when the template is %s', async (_case, overrides) => {
    const { service, deleteFn } = serviceFor({
      id: TEMPLATE_ID,
      code: 'ci-draft',
      name: 'Draft template',
      documentType: 'CI',
      locale: 'en-US',
      ...overrides,
    });
    await expect(service.remove(TEMPLATE_ID, 'actor-1', 'request-1')).rejects.toMatchObject({
      code: ERROR_CODES.documentTemplateNotDeletable,
    });
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('refuses deletion when a document references the template', async () => {
    const { service, deleteFn } = serviceFor({
      id: TEMPLATE_ID,
      code: 'ci-draft',
      name: 'Draft template',
      documentType: 'CI',
      locale: 'en-US',
      status: 'DRAFT',
      isDefault: false,
      _count: { versions: 0, documents: 1 },
    });
    await expect(service.remove(TEMPLATE_ID, 'actor-1', 'request-1')).rejects.toMatchObject({
      code: ERROR_CODES.documentTemplateInUse,
    });
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('refuses deletion when a PDF render job references a template version', async () => {
    const { service, deleteFn, deleteVersions } = serviceFor(
      {
        id: TEMPLATE_ID,
        code: 'ci-disabled',
        name: 'Old CI template',
        documentType: 'CI',
        locale: 'en-US',
        status: 'DISABLED',
        isDefault: false,
        _count: { versions: 1, documents: 0 },
      },
      { versionIds: [VERSION_ID], renderJobCount: 1 },
    );
    await expect(service.remove(TEMPLATE_ID, 'actor-1', 'request-1')).rejects.toMatchObject({
      code: ERROR_CODES.documentTemplateInUse,
    });
    expect(deleteVersions).not.toHaveBeenCalled();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('returns a not-found error for a missing template', async () => {
    const { service } = serviceFor(null);
    await expect(service.remove(TEMPLATE_ID, 'actor-1', 'request-1')).rejects.toMatchObject({
      code: ERROR_CODES.documentTemplateNotFound,
    });
  });
});

describe('DocumentTemplatesService default scope', () => {
  function serviceForUpdate() {
    const row = template({ status: 'ACTIVE', isDefault: false });
    const findUnique = vi.fn(async () => row);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const update = vi.fn(async () => ({ ...row, isDefault: true }));
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        documentTemplate: { updateMany, update },
      }),
    );
    const service = new DocumentTemplatesService(
      {
        documentTemplate: { findUnique },
        $transaction: transaction,
      } as unknown as PrismaService,
      { record: vi.fn() } as unknown as AuditService,
    );
    return { service, updateMany, update };
  }

  it('clears another default only within the same document type and locale', async () => {
    const { service, updateMany } = serviceForUpdate();
    await service.update(
      TEMPLATE_ID,
      { isDefault: true, locale: 'zh-CN', expectedUpdatedAt: '2026-11-01T00:00:00.000Z' },
      'actor-1',
      'request-1',
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        documentType: 'CI',
        locale: 'zh-CN',
        isDefault: true,
        id: { not: TEMPLATE_ID },
      },
      data: { isDefault: false },
    });
  });

  it('removes the default marker when a template leaves the active state', async () => {
    const { service, update } = serviceForUpdate();
    await service.update(
      TEMPLATE_ID,
      { status: 'DISABLED', expectedUpdatedAt: '2026-11-01T00:00:00.000Z' },
      'actor-1',
      'request-1',
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DISABLED', isDefault: false }),
      }),
    );
  });
});

describe('DocumentTemplatesService temporary preview and validation', () => {
  it('validates an unsaved config without writing to the database', async () => {
    const row = template({ status: 'DRAFT' });
    const findUnique = vi.fn(async () => row);
    const update = vi.fn();
    const prisma = {
      documentTemplate: { findUnique, update },
    } as unknown as PrismaService;
    const service = new DocumentTemplatesService(prisma, {
      record: vi.fn(),
    } as unknown as AuditService);
    const config = createDefaultTemplateConfig('CI');
    const description = config.itemColumns.find((column) => column.key === 'items.description');
    if (description) description.visible = false;

    const report = await service.validateTemplate(TEMPLATE_ID, {
      config,
      documentType: 'CI',
      locale: 'en-US',
    });

    expect(report.data.valid).toBe(true);
    expect(report.data.warnings).toContain('items.description.missing');
    expect(update).not.toHaveBeenCalled();
  });

  it('previews the unsaved config without saving the draft', async () => {
    const row = template({ status: 'DRAFT' });
    const findUnique = vi.fn(async () => row);
    const update = vi.fn();
    const prisma = {
      documentTemplate: { findUnique, update },
    } as unknown as PrismaService;
    const service = new DocumentTemplatesService(prisma, {
      record: vi.fn(),
    } as unknown as AuditService);
    const config = createDefaultTemplateConfig('CI');
    const revision = config.sections
      .find((section) => section.key === 'invoice')
      ?.fields.find((field) => field.key === 'document.revision');
    if (revision) revision.visible = false;

    const result = await service.preview(TEMPLATE_ID, { config });

    expect(result.data.html).not.toContain('Revision');
    expect(result.data.html).not.toContain('R1');
    expect(update).not.toHaveBeenCalled();
  });
});
