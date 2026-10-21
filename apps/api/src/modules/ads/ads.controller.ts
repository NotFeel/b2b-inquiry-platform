import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { upsertAdSchema, type UpsertAdInput } from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { AuditService } from '../../common/services/audit.service';
import { AdsService } from './ads.service';

@Controller('admin/ads')
export class AdsController {
  constructor(
    private readonly ads: AdsService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions(Permission.adRead)
  @Get()
  async list() {
    return { data: await this.ads.list() };
  }

  @RequirePermissions(Permission.adUpdate)
  @Post()
  async upsert(
    @Body(zodPipe(upsertAdSchema)) body: UpsertAdInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    await this.ads.assertAssetsExist([body.desktopAssetId, body.mobileAssetId]);
    const ad = await this.ads.upsert(body);
    await this.audit.record({
      actorId: actor.id,
      action: 'ad.upsert',
      entityType: 'ad',
      entityId: ad.id,
      requestId,
      metadata: { code: ad.code, placement: ad.placement, enabled: ad.enabled },
    });
    return { data: ad };
  }

  @RequirePermissions(Permission.adUpdate)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    const result = await this.ads.remove(id);
    await this.audit.record({
      actorId: actor.id,
      action: 'ad.delete',
      entityType: 'ad',
      entityId: id,
      requestId,
    });
    return result;
  }
}
