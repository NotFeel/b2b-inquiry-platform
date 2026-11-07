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
    const findUnique = vi.fn(async () => templateRow);
    const prisma = {
      documentTemplate: { findUnique, update },
      documentTemplateVersion: { create },
      $transaction: async (callback: (tx: unknown) => unknown) =>
        callback({
          documentTemplateVersion: { create },
          documentTemplate: { update },
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
