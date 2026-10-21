import { Controller, Get, Query } from '@nestjs/common';
import { publicLocaleQuerySchema } from '@b2b/validation';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { CategoriesService } from './categories.service';

@Controller('public/categories')
export class PublicCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Public()
  @Get()
  async list(@Query(zodPipe(publicLocaleQuerySchema)) query: { locale: string }) {
    return { data: await this.categories.listPublicTree(query.locale) };
  }
}
