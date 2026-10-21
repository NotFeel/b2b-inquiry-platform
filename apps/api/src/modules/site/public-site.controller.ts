import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Controller('public/site-config')
export class PublicSiteController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Public storefront configuration: branding, contact details, the WhatsApp
   * number and the batch inquiry limit. Only settings flagged public are
   * projected; secrets are never included (docs/01 §3.7).
   */
  @Public()
  @Get()
  async get() {
    const logoAssetId = await this.settings.getString('site.logoFileAssetId');
    let logoUrl: string | null = null;
    if (logoAssetId) {
      const asset = await this.prisma.fileAsset.findUnique({ where: { id: logoAssetId } });
      if (asset) logoUrl = this.storage.publicUrl(asset.storageKey);
    }
    return { data: await this.settings.getPublicSiteConfig(logoUrl) };
  }
}
