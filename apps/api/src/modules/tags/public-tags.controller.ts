import { Controller, Get, Query } from '@nestjs/common';
import { publicLocaleQuerySchema } from '@b2b/validation';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { TagsService } from './tags.service';

@Controller('public/tags')
export class PublicTagsController {
  constructor(private readonly tags: TagsService) {}

  @Public()
  @Get()
  async list(@Query(zodPipe(publicLocaleQuerySchema)) query: { locale: string }) {
    return { data: await this.tags.publicFilters(query.locale) };
  }
}
