import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { QuotationExportController } from './quotation-export.controller';
import { QuotationExportService } from './quotation-export.service';
import { QuotationOrderController } from './quotation-order.controller';
import { QuotationOrderService } from './quotation-order.service';

@Module({
  imports: [CategoriesModule],
  controllers: [QuotationExportController, QuotationOrderController],
  providers: [QuotationExportService, QuotationOrderService],
  exports: [QuotationExportService],
})
export class QuotationExportModule {}
