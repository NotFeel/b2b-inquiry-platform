import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PRODUCT_IMPORT_LIMITS } from '@b2b/contracts';
import {
  productImportCommitSchema,
  productImportSettingsSchema,
  type ProductImportCommitInput,
  type ProductImportSettingsInput,
} from '@b2b/validation';
import type { Response } from 'express';
import { ApiError } from '../../common/errors/api-error';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { ProductBulkImportService } from './product-bulk-import.service';

interface ImportMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('admin/products/bulk-import')
export class ProductBulkImportController {
  constructor(private readonly imports: ProductBulkImportService) {}

  @RequirePermissions(Permission.productImport)
  @Get('template')
  async template(@Res() response: Response): Promise<void> {
    const buffer = await this.imports.template();
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="b2b-product-bulk-import-template.xlsx"',
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(buffer);
  }

  @RequirePermissions(Permission.productImport)
  @Post('validate')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PRODUCT_IMPORT_LIMITS.maxBytes },
    }),
  )
  async validate(
    @UploadedFile() file: ImportMulterFile | undefined,
    @Body(zodPipe(productImportSettingsSchema)) settings: ProductImportSettingsInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    if (!file) {
      throw ApiError.validation('An .xlsx workbook is required.', {
        file: 'products.import.errors.fileRequired',
      });
    }
    return {
      data: await this.imports.validate(
        { buffer: file.buffer, originalName: file.originalname },
        settings,
        actor,
        requestId,
      ),
    };
  }

  @RequirePermissions(Permission.productImport, Permission.productCreate)
  @Post('commit')
  @HttpCode(201)
  async commit(
    @Body(zodPipe(productImportCommitSchema)) body: ProductImportCommitInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.imports.commit(body.validationId, actor, requestId),
    };
  }
}
