import { Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PRODUCT_IMAGE_LIMITS, ERROR_CODES, type MediaStagingResult } from '@b2b/contracts';
import type { Response } from 'express';
import { ApiError } from '../../common/errors/api-error';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedActor } from '../../common/request-context';
import { StorageService } from '../../common/services/storage.service';
import { FilesService } from './files.service';

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Staging upload for the product gallery (docs/24 §6.2).
 *
 * The purpose is fixed here instead of being taken from the query string: a
 * caller with `product.image.upload` must not be able to store an arbitrary
 * file class (an Excel workbook, a "logo") through the media endpoint. The asset
 * is validated, stored under a server-generated key and returned as
 * `fileAssetId`; it only becomes part of a product when the product endpoint
 * attaches it, and anything still unattached is swept by the staging TTL job.
 */
@Controller('admin/media')
export class MediaController {
  constructor(
    private readonly files: FilesService,
    private readonly storage: StorageService,
  ) {}

  @RequirePermissions(Permission.productImageUpload)
  @Post('staging')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PRODUCT_IMAGE_LIMITS.maxBytes } }))
  async staging(
    @UploadedFile() file: MulterFile | undefined,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ): Promise<{ data: MediaStagingResult }> {
    if (!file) {
      throw ApiError.validation('An image file is required.', { file: 'validation.required' });
    }
    const uploaded = await this.files.upload(
      {
        purpose: 'product-image',
        originalName: file.originalname,
        declaredMime: file.mimetype,
        buffer: file.buffer,
      },
      actor.id,
      requestId,
    );
    if (!uploaded.url) {
      // A stored image the API cannot address is not a usable preview: fail
      // loudly instead of handing the editor a gallery tile that never loads.
      throw new ApiError(ERROR_CODES.storageError, 'The stored image has no readable URL.');
    }
    return {
      data: {
        fileAssetId: uploaded.id,
        storageKey: uploaded.storageKey,
        version: uploaded.version,
        originalName: uploaded.originalName,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        width: uploaded.width,
        height: uploaded.height,
        status: uploaded.status as MediaStagingResult['status'],
        url: uploaded.url,
      },
    };
  }

  @RequirePermissions(Permission.productImageUpload)
  @Get('staging/:id')
  async stagingStatus(@Param('id') id: string): Promise<{ data: MediaStagingResult }> {
    return { data: await this.files.getStagingAsset(id) };
  }

  @RequirePermissions(Permission.productRead)
  @Get('assets/:id/preview')
  async preview(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const asset = await this.files.getAssetOrThrow(id);
    if (asset.purpose !== 'product-image' || asset.status !== 'ready') {
      response.status(404).json({
        error: {
          code: ERROR_CODES.fileNotFound,
          message: 'File not found.',
          requestId: 'media-preview',
        },
      });
      return;
    }
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const stream = this.storage.createReadStream(asset.storageKey);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}
