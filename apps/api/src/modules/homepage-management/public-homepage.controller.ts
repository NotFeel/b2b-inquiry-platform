import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  publicHomepageQuerySchema,
  publicLocaleQuerySchema,
  uuidSchema,
  type PublicHomepageQuery,
} from '@b2b/validation';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { PublicHomepageService } from './public-homepage.service';

/** Unauthenticated, price-free homepage data (docs/45 stage D). */
@Controller('public/homepage')
export class PublicHomepageController {
  constructor(private readonly homepage: PublicHomepageService) {}

  @Public()
  @Get()
  async overview(@Query(zodPipe(publicLocaleQuerySchema)) query: { locale: string }) {
    return { data: await this.homepage.getHomepage(query.locale) };
  }

  @Public()
  @Get('new-arrivals')
  async newArrivals(@Query(zodPipe(publicHomepageQuerySchema)) query: PublicHomepageQuery) {
    return {
      data: await this.homepage.getNewArrivals(query.locale, query.cursor),
    };
  }

  @Public()
  @Get('collections/:id/products')
  async collectionProducts(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Query(zodPipe(publicHomepageQuerySchema)) query: PublicHomepageQuery,
  ) {
    return {
      data: await this.homepage.getCollectionProducts(id, query.locale, query.cursor),
    };
  }
}
