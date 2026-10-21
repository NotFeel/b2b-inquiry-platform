import { describe, expect, it, vi } from 'vitest';
import type { SanitizeService } from '../../common/services/sanitize.service';
import type { AppEnv } from '../../config/config.module';
import type { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from './content.service';

const env = {
  APP_BASE_URL: 'http://localhost:3000',
  REVALIDATE_SECRET: undefined,
} as unknown as AppEnv;

describe('ContentService.listPublicPages', () => {
  it('returns only the published page slugs used by storefront navigation', async () => {
    const prisma = {
      contentPage: {
        findMany: vi.fn(async () => [
          { slug: 'about', pageType: 'about' },
          { slug: 'factory', pageType: 'factory' },
        ]),
      },
    };
    const service = new ContentService(
      prisma as unknown as PrismaService,
      {} as SanitizeService,
      env,
    );

    await expect(service.listPublicPages()).resolves.toEqual([
      { slug: 'about', pageType: 'about' },
      { slug: 'factory', pageType: 'factory' },
    ]);
    expect(prisma.contentPage.findMany).toHaveBeenCalledWith({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      select: { slug: true, pageType: true },
    });
  });
});

describe('ContentService.listPublicFaq', () => {
  it('uses the requested locale only and sorts by category and stable order', async () => {
    const findMany = vi.fn(async () => [
      {
        id: 'wholesale',
        category: 'wholesale',
        sortOrder: 50,
        enabled: true,
        translations: [
          { locale: 'en-US', question: 'Wholesale question', answer: '<p>Wholesale answer</p>' },
        ],
      },
      {
        id: 'products-later',
        category: 'products',
        sortOrder: 40,
        enabled: true,
        translations: [
          { locale: 'en-US', question: 'Pricing question', answer: '<p>Pricing answer</p>' },
        ],
      },
      {
        id: 'products-first',
        category: 'products',
        sortOrder: 10,
        enabled: true,
        translations: [
          { locale: 'en-US', question: 'Product question', answer: '<p>Product answer</p>' },
        ],
      },
    ]);
    const sanitize = { cleanRichText: vi.fn((value: string) => value) };
    const service = new ContentService(
      { faqItem: { findMany } } as unknown as PrismaService,
      sanitize as unknown as SanitizeService,
      env,
    );

    const result = await service.listPublicFaq('en-US');

    expect(result.map((entry) => entry.id)).toEqual([
      'products-first',
      'products-later',
      'wholesale',
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { translations: true },
    });
  });

  it('does not leak English answers into a Chinese page', async () => {
    const service = new ContentService(
      {
        faqItem: {
          findMany: vi.fn(async () => [
            {
              id: 'english-only',
              category: 'products',
              sortOrder: 10,
              enabled: true,
              translations: [
                {
                  locale: 'en-US',
                  question: 'English question',
                  answer: '<p>English answer</p>',
                },
              ],
            },
          ]),
        },
      } as unknown as PrismaService,
      { cleanRichText: vi.fn((value: string) => value) } as unknown as SanitizeService,
      env,
    );

    await expect(service.listPublicFaq('zh-CN')).resolves.toEqual([]);
  });
});
