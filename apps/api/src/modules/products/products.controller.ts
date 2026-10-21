import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  createProductSchema,
  productImageAttachSchema,
  productImageOrderSchema,
  productImageUpdateSchema,
  productListQuerySchema,
  productSlugSuggestionSchema,
  publishProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type ProductImageAttachInput,
  type ProductImageOrderInput,
  type ProductImageUpdateInput,
  type ProductListQueryInput,
  type ProductSlugSuggestionInput,
  type UpdateProductInput,
} from '@b2b/validation';
import { ERROR_CODES } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { ProductImagesService } from './product-images.service';
import { ProductsService } from './products.service';

/**
 * Product administration (docs/24 §6.1-§6.2).
 *
 * Every route declares its own permission: reading, creating, editing,
 * publishing, gallery upload/update/delete and the internal price are separate
 * capabilities, and hiding a button in the admin UI is never the control.
 * Images are managed through their own endpoints so a form save can never
 * replace a gallery - or lose the storage keys of the objects in it.
 */
@Controller('admin/products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly images: ProductImagesService,
  ) {}

  @RequirePermissions(Permission.productRead)
  @Get()
  async list(
    @Query(zodPipe(productListQuerySchema)) query: ProductListQueryInput,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.products.list(query, actor.permissions.has(Permission.productCostRead));
  }

  @RequirePermissions(Permission.productRead)
  @Get(':id')
  async detail(@Param('id') id: string, @CurrentActor() actor: AuthenticatedActor) {
    return { data: await this.products.detail(id, this.canSeeCost(actor)) };
  }

  /**
   * Generates a unique candidate without reserving it. Create/update still
   * validates the submitted slug and the database unique index remains final.
   */
  @RequirePermissions(Permission.productRead)
  @Post('slug-suggestion')
  async slugSuggestion(
    @Body(zodPipe(productSlugSuggestionSchema)) body: ProductSlugSuggestionInput,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    this.assertCanSuggestSlug(actor);
    return { data: await this.products.suggestSlug(body) };
  }

  @RequirePermissions(Permission.productCreate)
  @Post()
  async create(
    @Body(zodPipe(createProductSchema)) body: CreateProductInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    this.assertCostWritable(body.priceCny, actor);
    return { data: await this.products.create(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.productUpdate)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(zodPipe(updateProductSchema)) body: UpdateProductInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    this.assertCostWritable(body.priceCny, actor);
    return { data: await this.products.update(id, body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.productPublish)
  @Post(':id/publish')
  async publish(
    @Param('id') id: string,
    @Body(zodPipe(publishProductSchema))
    body: { publishStatus: 'draft' | 'published' | 'unpublished' },
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.products.setPublishStatus(id, body.publishStatus, actor.id, requestId),
    };
  }

  @RequirePermissions(Permission.productPublish)
  @Post(':id/unpublish')
  async unpublish(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.products.setPublishStatus(id, 'unpublished', actor.id, requestId),
    };
  }

  /**
   * Permanent delete. Answers 202: the response reports that the physical
   * removal has been accepted, not that it already happened (docs/24 §4.3).
   */
  @RequirePermissions(Permission.productDelete)
  @Delete(':id')
  @HttpCode(HttpStatus.ACCEPTED)
  async remove(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.products.remove(id, actor.id, requestId) };
  }

  /** Attaches staged assets to the gallery (docs/24 §6.2). */
  @RequirePermissions(Permission.productImageUpload)
  @Post(':id/images')
  async attachImages(
    @Param('id') id: string,
    @Body(zodPipe(productImageAttachSchema)) body: ProductImageAttachInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.images.attach(id, body, actor.id, requestId) };
  }

  /** Declared before `:imageId` so `order` is not read as an image id. */
  @RequirePermissions(Permission.productImageUpdate)
  @Patch(':id/images/order')
  async reorderImages(
    @Param('id') id: string,
    @Body(zodPipe(productImageOrderSchema)) body: ProductImageOrderInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.images.reorder(id, body.imageIds, actor.id, requestId) };
  }

  @RequirePermissions(Permission.productImageUpdate)
  @Put(':id/images/:imageId/cover')
  async setCover(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.images.setCover(id, imageId, actor.id, requestId) };
  }

  @RequirePermissions(Permission.productImageUpdate)
  @Patch(':id/images/:imageId')
  async updateImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Body(zodPipe(productImageUpdateSchema)) body: ProductImageUpdateInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.images.updateAltText(id, imageId, body, actor.id, requestId) };
  }

  /**
   * Permanent physical delete of one image. The storage key is resolved from the
   * database row; the request cannot name a path or an object (docs/24 §7).
   */
  @RequirePermissions(Permission.productImageDelete)
  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.ACCEPTED)
  async deleteImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    const result = await this.images.requestDeletion(id, imageId, actor.id, requestId);
    return {
      data: {
        operationId: result.operationId,
        status: result.status,
        imageId: result.imageId,
        messageKey: 'product.image.deletePending',
      },
    };
  }

  private canSeeCost(actor: AuthenticatedActor): boolean {
    return actor.permissions.has(Permission.productCostRead);
  }

  private assertCanSuggestSlug(actor: AuthenticatedActor): void {
    if (actor.roles.includes('super_admin')) return;
    if (
      actor.permissions.has(Permission.productCreate) ||
      actor.permissions.has(Permission.productUpdate)
    ) {
      return;
    }
    throw ApiError.forbidden(
      'Generating a product slug requires the product.create or product.update permission.',
    );
  }

  /**
   * The internal price is quote/PI input. Writing it needs its own permission:
   * an operator who may maintain the catalogue must not be able to change the
   * cost basis just because they can edit the product (docs/24 §3.3 D).
   */
  private assertCostWritable(priceCny: unknown, actor: AuthenticatedActor): void {
    if (priceCny === undefined || priceCny === null) return;
    if (actor.permissions.has(Permission.productCostUpdate)) return;
    throw new ApiError(
      ERROR_CODES.forbidden,
      'Changing the internal price requires the product.cost.update permission.',
    );
  }
}
