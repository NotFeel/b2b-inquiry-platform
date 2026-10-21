import { Controller, Get, Query } from '@nestjs/common';
import { publicLocaleQuerySchema } from '@b2b/validation';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { ContentOperationsService } from './content-operations.service';

@Controller('public/content')
export class PublicContentOperationsController {
  constructor(private readonly content: ContentOperationsService) {}

  @Public()
  @Get('factory')
  async factory(@Query(zodPipe(publicLocaleQuerySchema)) query: { locale: string }) {
    return { data: await this.content.publicFactory(query.locale) };
  }

  @Public()
  @Get('quality')
  async quality(@Query(zodPipe(publicLocaleQuerySchema)) query: { locale: string }) {
    return { data: await this.content.publicQuality(query.locale) };
  }

  @Public()
  @Get('home-sections')
  async homeSections(@Query(zodPipe(publicLocaleQuerySchema)) query: { locale: string }) {
    return { data: await this.content.publicHomeSections(query.locale) };
  }
}
