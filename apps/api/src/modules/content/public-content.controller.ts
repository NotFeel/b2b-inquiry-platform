import { Controller, Get, Param, Query } from '@nestjs/common';
import { ERROR_CODES } from '@b2b/contracts';
import { publicLocaleQuerySchema } from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { ContentService } from './content.service';

@Controller('public/content')
export class PublicContentController {
  constructor(private readonly content: ContentService) {}

  @Public()
  @Get('faq')
  async faq(@Query(zodPipe(publicLocaleQuerySchema)) query: { locale: string }) {
    return { data: await this.content.listPublicFaq(query.locale) };
  }

  @Public()
  @Get('pages')
  async pages() {
    return { data: await this.content.listPublicPages() };
  }

  @Public()
  @Get('pages/:slug')
  async page(
    @Param('slug') slug: string,
    @Query(zodPipe(publicLocaleQuerySchema)) query: { locale: string },
  ) {
    const page = await this.content.getPublicPage(slug, query.locale);
    if (!page) throw new ApiError(ERROR_CODES.notFound, 'Page not found.');
    return { data: page };
  }
}
