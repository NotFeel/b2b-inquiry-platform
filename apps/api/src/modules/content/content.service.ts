import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  FAQ_CATEGORY_CODES,
  type FaqCategoryCode,
  type PublicContentPage,
  type PublicContentPageRef,
  type PublicFaqItem,
} from '@b2b/contracts';
import type { UpsertContentPageInput, UpsertFaqInput } from '@b2b/validation';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { SanitizeService } from '../../common/services/sanitize.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitize: SanitizeService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async listPages() {
    const pages = await this.prisma.contentPage.findMany({
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: { translations: true },
    });
    return pages.map((page) => ({
      id: page.id,
      slug: page.slug,
      pageType: page.pageType,
      status: page.status.toLowerCase() as 'draft' | 'published' | 'unpublished',
      sortOrder: page.sortOrder,
      translations: Object.fromEntries(
        page.translations.map((translation) => [
          translation.locale,
          {
            title: translation.title,
            bodyHtml: this.sanitize.cleanRichText(translation.bodyHtml),
            seoTitle: translation.seoTitle,
            seoDescription: translation.seoDescription,
          },
        ]),
      ),
      updatedAt: page.updatedAt.toISOString(),
    }));
  }

  async upsertPage(input: UpsertContentPageInput) {
    const status = input.status.toUpperCase() as 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
    const page = await this.prisma.contentPage.upsert({
      where: { slug: input.slug },
      create: { slug: input.slug, pageType: input.pageType, status, sortOrder: input.sortOrder },
      update: { pageType: input.pageType, status, sortOrder: input.sortOrder },
    });
    for (const translation of input.translations) {
      const bodyHtml = this.sanitize.cleanRichText(translation.bodyHtml);
      await this.prisma.contentPageTranslation.upsert({
        where: { pageId_locale: { pageId: page.id, locale: translation.locale } },
        create: {
          pageId: page.id,
          locale: translation.locale,
          title: translation.title,
          bodyHtml,
          seoTitle: translation.seoTitle ?? null,
          seoDescription: translation.seoDescription ?? null,
        },
        update: {
          title: translation.title,
          bodyHtml,
          seoTitle: translation.seoTitle ?? null,
          seoDescription: translation.seoDescription ?? null,
        },
      });
    }
    return page;
  }

  async removePage(id: string) {
    const page = await this.prisma.contentPage.findUnique({ where: { id } });
    if (!page) throw ApiError.notFound('Content page not found.');
    await this.prisma.contentPage.delete({ where: { id } });
    return { deleted: true };
  }

  async listFaq() {
    const items = await this.prisma.faqItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { translations: true },
    });
    return items.map((item) => ({
      id: item.id,
      code: item.code,
      category: item.category,
      sortOrder: item.sortOrder,
      enabled: item.enabled,
      translations: Object.fromEntries(
        item.translations.map((translation) => [
          translation.locale,
          {
            question: translation.question,
            answerHtml: this.sanitize.cleanRichText(translation.answer),
          },
        ]),
      ),
      updatedAt: item.updatedAt.toISOString(),
    }));
  }

  async upsertFaq(input: UpsertFaqInput, id?: string) {
    const item = id
      ? await this.prisma.faqItem.update({
          where: { id },
          data: {
            category: input.category,
            sortOrder: input.sortOrder,
            enabled: input.enabled,
          },
        })
      : await this.prisma.faqItem.create({
          data: {
            code: input.code,
            category: input.category,
            sortOrder: input.sortOrder,
            enabled: input.enabled,
          },
        });
    for (const translation of input.translations) {
      const answer = this.sanitize.cleanRichText(translation.answerHtml) ?? '';
      await this.prisma.faqTranslation.upsert({
        where: { faqId_locale: { faqId: item.id, locale: translation.locale } },
        create: {
          faqId: item.id,
          locale: translation.locale,
          question: translation.question,
          answer,
        },
        update: { question: translation.question, answer },
      });
    }
    await this.revalidateFaq('faq_updated');
    return item;
  }

  async removeFaq(id: string) {
    await this.prisma.faqItem.delete({ where: { id } });
    await this.revalidateFaq('faq_deleted');
    return { deleted: true };
  }

  async getPublicPage(slug: string, locale: string): Promise<PublicContentPage | null> {
    const page = await this.prisma.contentPage.findFirst({
      where: { slug, status: 'PUBLISHED' },
      include: { translations: true },
    });
    if (!page) return null;
    const translation =
      page.translations.find((item) => item.locale === locale) ??
      page.translations.find((item) => item.locale === 'en-US');
    if (!translation) return null;
    return {
      slug: page.slug,
      pageType: page.pageType,
      title: translation.title,
      bodyHtml: this.sanitize.cleanRichText(translation.bodyHtml),
      seoTitle: translation.seoTitle,
      seoDescription: translation.seoDescription,
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  /**
   * Slugs of published pages, used by the storefront to build navigation
   * without probing each optional URL and generating a stream of 404s.
   */
  async listPublicPages(): Promise<PublicContentPageRef[]> {
    const pages = await this.prisma.contentPage.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      select: { slug: true, pageType: true },
    });
    return pages;
  }

  async listPublicFaq(locale: string): Promise<PublicFaqItem[]> {
    const items = await this.prisma.faqItem.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { translations: true },
    });
    return items
      .map((item) => {
        // FAQ copy must be reviewed for each locale. Falling back to English on
        // a Chinese page would silently expose the wrong language (FAQ spec §4.3).
        const translation = item.translations.find((candidate) => candidate.locale === locale);
        if (!translation) return null;
        const answerHtml = this.sanitize.cleanRichText(translation.answer);
        if (!answerHtml) return null;
        const category = FAQ_CATEGORY_CODES.includes(item.category as FaqCategoryCode)
          ? (item.category as FaqCategoryCode)
          : 'products';
        return {
          id: item.id,
          category,
          sortOrder: item.sortOrder,
          question: translation.question,
          answerHtml,
        };
      })
      .filter((item): item is PublicFaqItem => item !== null)
      .sort((left, right) => {
        const categoryDifference =
          FAQ_CATEGORY_CODES.indexOf(left.category) - FAQ_CATEGORY_CODES.indexOf(right.category);
        if (categoryDifference !== 0) return categoryDifference;
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        return left.id.localeCompare(right.id);
      });
  }

  /** Keep the storefront's tagged FAQ fetch in sync after admin changes. */
  private async revalidateFaq(reason: string): Promise<void> {
    const secret = this.env.REVALIDATE_SECRET;
    if (!secret) return;
    try {
      const response = await fetch(`${this.env.APP_BASE_URL}/api/revalidate?tag=faq`, {
        method: 'POST',
        headers: { 'x-revalidate-secret': secret },
      });
      if (!response.ok) {
        this.logger.warn(`FAQ revalidation failed (${reason}): HTTP ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `FAQ revalidation failed (${reason}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
