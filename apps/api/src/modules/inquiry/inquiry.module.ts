import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { InquiryService } from './inquiry.service';
import { PublicInquiryController } from './public-inquiry.controller';

@Module({
  imports: [ProductsModule, SettingsModule],
  controllers: [PublicInquiryController],
  providers: [InquiryService],
  exports: [InquiryService],
})
export class InquiryModule {}
