import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { DictionaryModule } from '../dictionary/dictionary.module';
import { FileOperationsController } from './file-operations.controller';
import { ProductImagesService } from './product-images.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { PublicCatalogService } from './public-catalog.service';
import { PublicProductsController } from './public-products.controller';

@Module({
  imports: [CategoriesModule, DictionaryModule],
  controllers: [ProductsController, FileOperationsController, PublicProductsController],
  providers: [ProductsService, ProductImagesService, PublicCatalogService],
  exports: [ProductsService, PublicCatalogService],
})
export class ProductsModule {}
