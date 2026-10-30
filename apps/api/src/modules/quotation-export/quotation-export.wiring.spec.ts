import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS } from '@b2b/contracts';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedActor } from '../../common/request-context';
import { PERMISSIONS_KEY } from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import type { RateLimitService } from '../../common/services/rate-limit.service';
import { QuotationExportController } from './quotation-export.controller';
import type { QuotationExportService } from './quotation-export.service';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '55555555-5555-4555-8555-555555555555';

function actor(permissions: string[] = [], roles: string[] = []): AuthenticatedActor {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    username: 'admin',
    displayName: 'Admin',
    roles,
    permissions: new Set(permissions),
    sessionId: 'session-id',
    mustChangePassword: false,
  };
}

function fakeService() {
  return {
    config: vi.fn().mockReturnValue({ maxProducts: 200 }),
    listTemplates: vi.fn().mockResolvedValue([]),
    listProducts: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    preview: vi.fn().mockResolvedValue({ items: [], errors: [] }),
    export: vi
      .fn()
      .mockResolvedValue({ buffer: Buffer.from('xlsx'), filename: 'Quotation_USD.xlsx' }),
  };
}

function fakeRateLimit() {
  return {
    consume: vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 99,
      retryAfterSeconds: 60,
    }),
  };
}

function controller(
  service: ReturnType<typeof fakeService>,
  rateLimit: ReturnType<typeof fakeRateLimit>,
) {
  return new QuotationExportController(
    service as unknown as QuotationExportService,
    rateLimit as unknown as RateLimitService,
  );
}

describe('quotation export controller wiring', () => {
  it('declares the five admin routes and their HTTP methods', () => {
    expect(Reflect.getMetadata(PATH_METADATA, QuotationExportController)).toBe(
      'admin/quotation-export',
    );
    const expected: Record<string, [RequestMethod, string]> = {
      config: [RequestMethod.GET, 'config'],
      templates: [RequestMethod.GET, 'templates'],
      products: [RequestMethod.GET, 'products'],
      preview: [RequestMethod.POST, 'preview'],
      export: [RequestMethod.POST, 'export'],
    };
    for (const [name, [method, path]] of Object.entries(expected)) {
      const handler = (QuotationExportController.prototype as unknown as Record<string, object>)[
        name
      ];
      if (!handler) throw new Error(`Missing controller handler: ${name}`);
      expect(Reflect.getMetadata(PATH_METADATA, handler), name).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler), name).toBe(method);
    }
  });

  it('enforces read for config/products and create for preview/export', () => {
    const expected: Record<string, string> = {
      config: PERMISSIONS.quotationExportRead,
      templates: PERMISSIONS.quotationExportRead,
      products: PERMISSIONS.quotationExportRead,
      preview: PERMISSIONS.quotationExportCreate,
      export: PERMISSIONS.quotationExportCreate,
    };
    for (const [name, permission] of Object.entries(expected)) {
      const handler = (QuotationExportController.prototype as unknown as Record<string, object>)[
        name
      ];
      if (!handler) throw new Error(`Missing controller handler: ${name}`);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler), name).toEqual([permission]);
    }
  });

  it('passes unpublished and cost permissions only to authorized actors', async () => {
    const service = fakeService();
    const quotationController = controller(service, fakeRateLimit());
    const query = {
      categoryId: CATEGORY_ID,
      includeDescendants: true,
      search: '',
      locale: 'en-US' as const,
    };

    await quotationController.products(query, actor());
    expect(service.listProducts).toHaveBeenLastCalledWith(query, false, false);

    await quotationController.products(query, actor([PERMISSIONS.quotationExportUnpublished]));
    expect(service.listProducts).toHaveBeenLastCalledWith(query, true, false);

    await quotationController.products(query, actor([PERMISSIONS.productCostRead]));
    expect(service.listProducts).toHaveBeenLastCalledWith(query, false, true);

    await quotationController.products(query, actor([], ['super_admin']));
    expect(service.listProducts).toHaveBeenLastCalledWith(query, true, true);
  });

  it('sets safe download headers before sending the generated XLSX', async () => {
    const service = fakeService();
    const rateLimit = fakeRateLimit();
    const quotationController = controller(service, rateLimit);
    const headers = new Map<string, string>();
    const response = {
      setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
      send: vi.fn(),
    } as unknown as Response;
    const input = {
      templateId: TEMPLATE_ID,
      categoryId: CATEGORY_ID,
      includeDescendants: true,
      productIds: [PRODUCT_ID],
      header: {
        companyName: 'Example Ltd.',
        contactPerson: 'Jerry',
        email: 'sales@example.com',
        phone: '+86 190 7428 9250',
        quotationTitle: 'Price List',
      },
      pricing: { markupPercent: '15', currencyCode: 'USD' as const, exchangeRate: '0.1385' },
    };

    await quotationController.export(input, actor(), 'request-123', response);

    expect(service.export).toHaveBeenCalledWith(input, false, actor().id, 'request-123');
    expect(rateLimit.consume).toHaveBeenCalledWith(`quotation-export:export:${actor().id}`, 10, 60);
    expect(headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(headers.get('Content-Disposition')).toContain('filename*=UTF-8');
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Request-Id')).toBe('request-123');
    expect(response.send).toHaveBeenCalledWith(Buffer.from('xlsx'));
  });

  it('rejects preview and export when the create rate limit is exhausted', async () => {
    const service = fakeService();
    const rateLimit = fakeRateLimit();
    rateLimit.consume.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 17,
    });
    const quotationController = controller(service, rateLimit);
    const previewInput = {
      categoryId: CATEGORY_ID,
      includeDescendants: true,
      productIds: [PRODUCT_ID],
      markupPercent: '15',
      currencyCode: 'USD' as const,
      exchangeRate: '0.1385',
    };

    const error = await quotationController
      .preview(previewInput, actor())
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 17 },
    });
    expect(service.preview).not.toHaveBeenCalled();
  });
});
