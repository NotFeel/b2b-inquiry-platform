import { Module } from '@nestjs/common';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';
import { PublicAdsController } from './public-ads.controller';

@Module({
  controllers: [AdsController, PublicAdsController],
  providers: [AdsService],
  exports: [AdsService],
})
export class AdsModule {}
