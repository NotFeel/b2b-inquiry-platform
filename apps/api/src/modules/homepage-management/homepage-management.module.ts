import { CategoriesModule } from '../categories/categories.module';
import { ProductsModule } from '../products/products.module';
import { Module } from '@nestjs/common';
import { HomepageManagementController } from './homepage-management.controller';
import { HomepageManagementService } from './homepage-management.service';
import { PublicHomepageController } from './public-homepage.controller';
import { PublicHomepageService } from './public-homepage.service';

@Module({
  imports: [CategoriesModule, ProductsModule],
  controllers: [HomepageManagementController, PublicHomepageController],
  providers: [HomepageManagementService, PublicHomepageService],
  exports: [HomepageManagementService, PublicHomepageService],
})
export class HomepageManagementModule {}
