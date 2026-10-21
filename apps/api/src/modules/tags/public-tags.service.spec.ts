import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../config/config.module';
import type { AuditService } from '../../common/services/audit.service';
import type { JsonLogger } from '../../common/logger.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { TagsService } from './tags.service';

describe('TagsService.publicFilters', () => {
  it('returns enabled tags with public product counts and locale labels', async () => {
    const prisma = {
      tag: {
        findMany: vi.fn(async () => [
          {
            id: 'tag-1',
            code: 'featured',
            colorToken: 'tag.brand',
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            translations: [
              { locale: 'en-US', label: 'Featured' },
              { locale: 'zh-CN', label: '精选' },
            ],
            _count: { products: 9 },
          },
          {
            id: 'tag-2',
            code: 'preorder',
            colorToken: 'tag.warning',
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            translations: [
              { locale: 'en-US', label: 'Pre-order' },
              { locale: 'zh-CN', label: '预售' },
            ],
            _count: { products: 1 },
          },
        ]),
      },
      productTag: {
        groupBy: vi.fn(async () => [
          { tagId: 'tag-1', _count: { _all: 3 } },
          { tagId: 'tag-2', _count: { _all: 5 } },
        ]),
      },
    };
    const service = new TagsService(
      prisma as unknown as PrismaService,
      {} as AuditService,
      {} as JsonLogger,
      {} as AppEnv,
    );

    await expect(service.publicFilters('zh-CN')).resolves.toEqual([
      {
        code: 'featured',
        label: '精选',
        colorToken: 'tag.brand',
        productCount: 3,
      },
      {
        code: 'preorder',
        label: '预售',
        colorToken: 'tag.warning',
        productCount: 5,
      },
    ]);
  });
});
