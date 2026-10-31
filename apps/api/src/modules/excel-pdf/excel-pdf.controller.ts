import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EXCEL_PDF_LIMITS } from '@b2b/contracts';
import {
  excelPdfJobListQuerySchema,
  excelPdfUploadInitSchema,
  parseIdempotencyKey,
  type ExcelPdfJobListQueryInput,
  type ExcelPdfUploadInitInput,
} from '@b2b/validation';
import type { Response } from 'express';
import { ApiError } from '../../common/errors/api-error';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { StorageService } from '../../common/services/storage.service';
import { ExcelPdfService } from './excel-pdf.service';

interface UploadFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('admin/excel-pdf')
export class ExcelPdfController {
  constructor(
    private readonly excelPdf: ExcelPdfService,
    private readonly storage: StorageService,
  ) {}

  @RequirePermissions(Permission.excelPdfRead)
  @Get('config')
  config() {
    return { data: this.excelPdf.config() };
  }

  @RequirePermissions(Permission.excelPdfCreate)
  @Post('uploads')
  @HttpCode(201)
  async initializeUpload(
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Body(zodPipe(excelPdfUploadInitSchema)) body: ExcelPdfUploadInitInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    const idempotencyKey = this.parseIdempotencyKey(rawIdempotencyKey);
    return {
      data: await this.excelPdf.initializeUpload(body, idempotencyKey, actor, requestId),
    };
  }

  @RequirePermissions(Permission.excelPdfCreate)
  @Put('uploads/:uploadId/chunks/:index')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: EXCEL_PDF_LIMITS.chunkBytes } }))
  async uploadChunk(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @Param('index') rawIndex: string,
    @UploadedFile() file: UploadFile | undefined,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    if (!file) {
      throw ApiError.validation('An upload chunk is required.', { file: 'validation.required' });
    }
    return {
      data: await this.excelPdf.uploadChunk(uploadId, Number(rawIndex), file.buffer, actor),
    };
  }

  @RequirePermissions(Permission.excelPdfCreate)
  @Post('uploads/:uploadId/complete')
  @HttpCode(202)
  async completeUpload(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.excelPdf.completeUpload(uploadId, actor, requestId) };
  }

  @RequirePermissions(Permission.excelPdfCreate)
  @Get('uploads/:uploadId')
  async uploadStatus(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return { data: await this.excelPdf.uploadStatus(uploadId, actor) };
  }

  @RequirePermissions(Permission.excelPdfCreate)
  @Post('uploads/:uploadId/cancel')
  @HttpCode(200)
  async cancelUpload(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.excelPdf.cancelUpload(uploadId, actor, requestId) };
  }

  @RequirePermissions(Permission.excelPdfRead)
  @Get('jobs')
  async listJobs(
    @Query(zodPipe(excelPdfJobListQuerySchema)) query: ExcelPdfJobListQueryInput,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.excelPdf.listJobs(query, actor);
  }

  @RequirePermissions(Permission.excelPdfRead)
  @Get('jobs/:id')
  async job(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return { data: await this.excelPdf.getJob(id, actor) };
  }

  @RequirePermissions(Permission.excelPdfDownload)
  @Get('jobs/:id/download')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.excelPdf.getDownload(id, actor, 'attachment', requestId);
    this.sendFile(response, file, requestId);
  }

  @RequirePermissions(Permission.excelPdfDownload)
  @Get('jobs/:id/preview')
  async preview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.excelPdf.getDownload(id, actor, 'inline', requestId);
    this.sendFile(response, file, requestId);
  }

  @RequirePermissions(Permission.excelPdfRetry)
  @Post('jobs/:id/retry')
  @HttpCode(202)
  async retry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.excelPdf.retry(id, actor, requestId) };
  }

  @RequirePermissions(Permission.excelPdfDelete)
  @Delete('jobs/:id')
  @HttpCode(202)
  async deleteJob(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.excelPdf.deleteJob(id, actor, requestId) };
  }

  private parseIdempotencyKey(value: string | undefined): string {
    try {
      return parseIdempotencyKey(value);
    } catch {
      throw ApiError.validation('A valid Idempotency-Key header is required.', {
        idempotencyKey: 'validation.required',
      });
    }
  }

  private sendFile(
    response: Response,
    file: {
      storageKey: string;
      sizeBytes: number;
      filename: string;
      mode: 'attachment' | 'inline';
    },
    requestId: string,
  ): void {
    const ascii = file.filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'excel-conversion.pdf';
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', String(file.sizeBytes));
    response.setHeader(
      'Content-Disposition',
      `${file.mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Request-Id', requestId);
    const stream = this.storage.createReadStream(file.storageKey);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}
