import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PRODUCT_IMPORT_LIMITS } from '@b2b/contracts';
import {
  productImportCommitSchema,
  productImportSettingsSchema,
  productImportUploadInitSchema,
  type ProductImportCommitInput,
  type ProductImportSettingsInput,
  type ProductImportUploadInitInput,
} from '@b2b/validation';
import type { Response } from 'express';
import { ApiError } from '../../common/errors/api-error';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { ProductImportUploadService } from './product-import-upload.service';
import { ProductBulkImportService } from './product-bulk-import.service';

interface ImportMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('admin/products/bulk-import')
export class ProductBulkImportController {
  constructor(
    private readonly imports: ProductBulkImportService,
    private readonly uploads: ProductImportUploadService,
  ) {}

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
      // The legacy endpoint remains available for small workbooks only. Large
      // workbooks use the chunked upload endpoints below so a request can never
      // hit Next's 10MB middleware/proxy limit.
      limits: { fileSize: PRODUCT_IMPORT_LIMITS.maxChunkBytes },
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

  @RequirePermissions(Permission.productImport)
  @Post('uploads')
  @HttpCode(201)
  async initializeUpload(
    @Body(zodPipe(productImportUploadInitSchema)) body: ProductImportUploadInitInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.uploads.initialize(body, actor, requestId) };
  }

  @RequirePermissions(Permission.productImport)
  @Put('uploads/:uploadId/chunks/:index')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PRODUCT_IMPORT_LIMITS.maxChunkBytes },
    }),
  )
  async uploadChunk(
    @Param('uploadId') uploadId: string,
    @Param('index') rawIndex: string,
    @UploadedFile() file: ImportMulterFile | undefined,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    if (!file) {
      throw ApiError.validation('An upload chunk is required.', {
        file: 'products.import.errors.fileRequired',
      });
    }
    const index = Number(rawIndex);
    return { data: await this.uploads.uploadChunk(uploadId, index, file.buffer, actor) };
  }

  @RequirePermissions(Permission.productImport)
  @Post('uploads/:uploadId/complete')
  @HttpCode(202)
  async completeUpload(
    @Param('uploadId') uploadId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.uploads.complete(uploadId, actor, requestId) };
  }

  @RequirePermissions(Permission.productImport)
  @Get('uploads/:uploadId')
  async uploadStatus(
    @Param('uploadId') uploadId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return { data: await this.uploads.status(uploadId, actor) };
  }

  @RequirePermissions(Permission.productImport)
  @Post('uploads/:uploadId/cancel')
  @HttpCode(200)
  async cancelUpload(
    @Param('uploadId') uploadId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.uploads.cancel(uploadId, actor, requestId) };
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
