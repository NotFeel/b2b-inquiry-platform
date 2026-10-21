import { Controller, Get, Query } from '@nestjs/common';
import { analyticsRangeQuerySchema, type AnalyticsRangeQuery } from '@b2b/validation';
import { Permission, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { AnalyticsService } from './analytics.service';

@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @RequirePermissions(Permission.analyticsRead)
  @Get('overview')
  async overview(@Query(zodPipe(analyticsRangeQuerySchema)) query: AnalyticsRangeQuery) {
    return { data: await this.analytics.overview(query) };
  }

  @RequirePermissions(Permission.analyticsRead)
  @Get('timeseries')
  async timeseries(@Query(zodPipe(analyticsRangeQuerySchema)) query: AnalyticsRangeQuery) {
    return { data: await this.analytics.timeseries(query) };
  }

  @RequirePermissions(Permission.analyticsRead)
  @Get('countries')
  async countries(@Query(zodPipe(analyticsRangeQuerySchema)) query: AnalyticsRangeQuery) {
    return { data: await this.analytics.countries(query) };
  }

  @RequirePermissions(Permission.analyticsRead)
  @Get('realtime')
  async realtime() {
    return { data: await this.analytics.realtime() };
  }
}
