import { Module } from '@nestjs/common';
import { ExcelPdfController } from './excel-pdf.controller';
import { ExcelPdfService } from './excel-pdf.service';

@Module({
  controllers: [ExcelPdfController],
  providers: [ExcelPdfService],
  exports: [ExcelPdfService],
})
export class ExcelPdfModule {}
