import { Controller, Get, Query } from '@nestjs/common';
import { publicAdQuerySchema } from '@b2b/validation';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { AdsService } from './ads.service';

@Controller('public/ads')
export class PublicAdsController {
  constructor(private readonly ads: AdsService) {}

  @Public()
  @Get()
  async list(@Query(zodPipe(publicAdQuerySchema)) query: { placement: string; locale: string }) {
    return { data: await this.ads.listPublicWithImages(query.placement, query.locale) };
  }
}
