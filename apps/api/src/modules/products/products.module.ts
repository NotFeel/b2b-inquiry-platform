import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { DictionaryModule } from '../dictionary/dictionary.module';
import { FilesModule } from '../files/files.module';
import { FileOperationsController } from './file-operations.controller';
import { ProductBulkImportController } from './product-bulk-import.controller';
import { ProductBulkImportService } from './product-bulk-import.service';
import { ProductImagesService } from './product-images.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { PublicCatalogService } from './public-catalog.service';
import { PublicProductsController } from './public-products.controller';

@Module({
  imports: [CategoriesModule, DictionaryModule, FilesModule],
  controllers: [
    // Keep the literal `bulk-import` route ahead of `products/:id`.
    ProductBulkImportController,
    ProductsController,
    FileOperationsController,
    PublicProductsController,
  ],
  providers: [
    ProductsService,
    ProductImagesService,
    ProductBulkImportService,
    PublicCatalogService,
  ],
  exports: [ProductsService, PublicCatalogService],
})
export class ProductsModule {}
