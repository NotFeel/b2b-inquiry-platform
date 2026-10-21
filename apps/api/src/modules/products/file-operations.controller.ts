import { Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedActor } from '../../common/request-context';
import { ProductImagesService } from './product-images.service';

/**
 * Physical-delete task inspection and manual retry (docs/24 §6.2, §12).
 *
 * The task row - not the queue - is the source of truth, so an operator can tell
 * a queued delete from a failed one even while Redis is unreachable. Retrying is
 * a privileged operation: it re-attempts the removal of a real stored object.
 */
@Controller('admin/file-operations')
export class FileOperationsController {
  constructor(private readonly images: ProductImagesService) {}

  @RequirePermissions(Permission.productRead)
  @Get(':operationId')
  async status(@Param('operationId') operationId: string) {
    return { data: await this.images.operationStatus(operationId) };
  }

  @RequirePermissions(Permission.productImageDelete)
  @Post(':operationId/retry')
  async retry(
    @Param('operationId') operationId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.images.retryOperation(operationId, actor.id, requestId) };
  }
}
