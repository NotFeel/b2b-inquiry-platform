import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ERROR_CODES } from '@b2b/contracts';
import {
  directUploadInitSchema,
  fileListQuerySchema,
  fileUploadQuerySchema,
  type DirectUploadInitInput,
} from '@b2b/validation';
import type { Response } from 'express';
import { ApiError } from '../../common/errors/api-error';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { StorageService } from '../../common/services/storage.service';
import { FilesService } from './files.service';

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('admin/files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly storage: StorageService,
  ) {}

  @RequirePermissions(Permission.fileUpload)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: MulterFile | undefined,
    @Query(zodPipe(fileUploadQuerySchema)) query: { purpose: string },
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    if (!file) {
      throw ApiError.validation('A file is required.', { file: 'validation.required' });
    }
    return this.files.upload(
      {
        purpose: query.purpose,
        originalName: file.originalname,
        declaredMime: file.mimetype,
        buffer: file.buffer,
      },
      actor.id,
      requestId,
    );
  }

  @RequirePermissions(Permission.fileUpload)
  @Post('presign-upload')
  async presignUpload(
    @Body(zodPipe(directUploadInitSchema)) body: DirectUploadInitInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.files.initiateDirectUpload(body, actor.id, requestId),
    };
  }

  @RequirePermissions(Permission.fileRead)
  @Get()
  async list(@Query(zodPipe(fileListQuerySchema)) query: Parameters<FilesService['list']>[0]) {
    return this.files.list(query);
  }

  @RequirePermissions(Permission.fileRead)
  @Get(':id/download')
  async download(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const asset = await this.files.getAssetOrThrow(id);
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(asset.originalName)}"`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const stream = this.storage.createReadStream(asset.storageKey);
    stream.on('error', () => {
      if (!response.headersSent) {
        response.status(404).json({
          error: {
            code: ERROR_CODES.fileNotFound,
            message: 'File not found.',
            requestId: 'stream',
          },
        });
      } else {
        response.destroy();
      }
    });
    stream.pipe(response);
  }

  @RequirePermissions(Permission.fileUpload)
  @Get(':id/status')
  async status(@Param('id') id: string) {
    return { data: await this.files.getAssetStatus(id) };
  }

  @RequirePermissions(Permission.fileUpload)
  @Post(':id/confirm-upload')
  async confirmUpload(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.files.confirmDirectUpload(id, actor.id, requestId) };
  }

  @RequirePermissions(Permission.fileRead)
  @Post(':id/signed-url')
  async signedUrl(@Param('id') id: string) {
    return this.files.createSignedUrl(id, 300);
  }

  @RequirePermissions(Permission.fileDelete)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Body() body: { confirm?: boolean },
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    if (body?.confirm !== true) {
      throw ApiError.validation('Deleting a file requires explicit confirmation.', {
        confirm: 'validation.required',
      });
    }
    return this.files.remove(id, actor.id, requestId);
  }
}
