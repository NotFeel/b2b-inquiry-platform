import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS } from '@b2b/contracts';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../common/decorators';
import type { AuthenticatedActor } from '../../common/request-context';
import { QuoteController } from './quote.controller';
import type { QuoteService } from './quote.service';

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';

function fakeService() {
  return {
    getTemplateFile: vi.fn().mockResolvedValue({
      body: Buffer.from('xlsx'),
      filename: '报价模板.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    previewTemplate: vi.fn().mockResolvedValue({ templateId: TEMPLATE_ID }),
    requestTemplateDeletion: vi.fn().mockResolvedValue({ status: 'deletion_pending' }),
  };
}

const actor: AuthenticatedActor = {
  id: '22222222-2222-4222-8222-222222222222',
  username: 'admin',
  displayName: 'Admin',
  roles: ['admin'],
  permissions: new Set([PERMISSIONS.quoteRead, PERMISSIONS.quoteDelete]),
  sessionId: 'session-id',
  mustChangePassword: false,
};

describe('quote template admin routes', () => {
  it('declares authenticated download, preview and delete routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, QuoteController)).toBe('admin');
    const expected: Record<string, [RequestMethod, string, string]> = {
      downloadTemplate: [RequestMethod.GET, 'quote-templates/:id/file', PERMISSIONS.quoteRead],
      previewTemplate: [RequestMethod.GET, 'quote-templates/:id/preview', PERMISSIONS.quoteRead],
      removeTemplate: [RequestMethod.DELETE, 'quote-templates/:id', PERMISSIONS.quoteDelete],
    };

    for (const [name, [method, path, permission]] of Object.entries(expected)) {
      const handler = (QuoteController.prototype as unknown as Record<string, object>)[name];
      if (!handler) throw new Error(`Missing controller handler: ${name}`);
      expect(Reflect.getMetadata(METHOD_METADATA, handler), name).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, handler), name).toBe(path);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler), name).toEqual([permission]);
    }
  });

  it('sends a private XLSX with safe download headers', async () => {
    const service = fakeService();
    const controller = new QuoteController(service as unknown as QuoteService);
    const headers = new Map<string, string>();
    const response = {
      setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
      send: vi.fn(),
    } as unknown as Response;

    await controller.downloadTemplate(TEMPLATE_ID, 'request-123', response);

    expect(service.getTemplateFile).toHaveBeenCalledWith(TEMPLATE_ID);
    expect(headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(headers.get('Content-Disposition')).toContain("filename*=UTF-8''");
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Request-Id')).toBe('request-123');
    expect(response.send).toHaveBeenCalledWith(Buffer.from('xlsx'));
  });

  it('returns previews and deletion requests through the service', async () => {
    const service = fakeService();
    const controller = new QuoteController(service as unknown as QuoteService);

    await expect(controller.previewTemplate(TEMPLATE_ID)).resolves.toEqual({
      data: { templateId: TEMPLATE_ID },
    });
    await expect(
      controller.removeTemplate(TEMPLATE_ID, actor, 'request-delete-1'),
    ).resolves.toEqual({ status: 'deletion_pending' });
    expect(service.requestTemplateDeletion).toHaveBeenCalledWith(
      TEMPLATE_ID,
      actor.id,
      'request-delete-1',
    );
  });
});
