import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PublicSiteController } from './public-site.controller';

@Module({
  imports: [SettingsModule],
  controllers: [PublicSiteController],
})
export class SiteModule {}
