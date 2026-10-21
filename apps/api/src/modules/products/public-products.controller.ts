import { Controller, Get, Param, Query } from '@nestjs/common';
import { publicProductListQuerySchema, type PublicProductListQuery } from '@b2b/validation';
import { ERROR_CODES } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { PublicCatalogService } from './public-catalog.service';

@Controller('public/products')
export class PublicProductsController {
  constructor(private readonly catalog: PublicCatalogService) {}

  @Public()
  @Get()
  async list(@Query(zodPipe(publicProductListQuerySchema)) query: PublicProductListQuery) {
    return this.catalog.list(query);
  }

  @Public()
  @Get(':slug')
  async detail(@Param('slug') slug: string) {
    const product = await this.catalog.detailBySlug(slug);
    if (!product) {
      // A draft, unpublished or discontinued product is indistinguishable from a
      // missing one to the public.
      throw new ApiError(ERROR_CODES.productNotFound, 'Product not found.');
    }
    return { data: product };
  }
}
