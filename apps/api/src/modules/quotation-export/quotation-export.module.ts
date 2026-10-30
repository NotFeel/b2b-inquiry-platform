import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { QuotationExportController } from './quotation-export.controller';
import { QuotationExportService } from './quotation-export.service';

@Module({
  imports: [CategoriesModule],
  controllers: [QuotationExportController],
  providers: [QuotationExportService],
  exports: [QuotationExportService],
})
export class QuotationExportModule {}
