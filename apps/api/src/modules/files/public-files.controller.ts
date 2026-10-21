import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { StorageService } from '../../common/services/storage.service';
import { FilesService } from './files.service';

// Serves only assets flagged public (product, category, ad and logo images).
// Internal artefacts such as quote exports, PI workbooks and archived uploads
// are never reachable through this route (docs/07 §7).
@Controller('files')
export class PublicFilesController {
  constructor(
    private readonly files: FilesService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get('signed/*key')
  async serveSigned(@Req() request: Request, @Res() response: Response): Promise<void> {
    const raw = (request.params as Record<string, unknown>)['key'];
    const segments = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    const storageKey = segments.join('/');
    const token = typeof request.query.token === 'string' ? request.query.token : '';
    if (storageKey.length === 0 || storageKey.includes('..') || token.length === 0) {
      response.status(400).json({
        error: { code: 'VALIDATION_FAILED', message: 'Invalid request.', requestId: 'signed-files' },
      });
      return;
    }
    if (!this.files.verifySignedToken(storageKey, token)) {
      response.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'The download link is invalid or expired.',
          requestId: 'signed-files',
        },
      });
      return;
    }
    const asset = await this.files.getAnyAssetByKey(storageKey);
    if (!asset) {
      response.status(404).json({
        error: { code: 'FILE_NOT_FOUND', message: 'File not found.', requestId: 'signed-files' },
      });
      return;
    }
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(asset.originalName)}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    const stream = this.storage.createReadStream(asset.storageKey);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }

  @Public()
  @Get('*key')
  async serve(@Req() request: Request, @Res() response: Response): Promise<void> {
    const raw = (request.params as Record<string, unknown>)['key'];
    const segments = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    const storageKey = segments.join('/');
    if (storageKey.length === 0 || storageKey.includes('..')) {
      response.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid path.', requestId: 'public-files' } });
      return;
    }
    const asset = await this.files.getPublicAsset(storageKey);
    if (!asset) {
      response.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'File not found.', requestId: 'public-files' } });
      return;
    }
    // The database row can outlive the object (manual cleanup, restored volume,
    // storage misconfiguration). Answer 404 instead of dropping the connection.
    const objectExists = await this.storage.exists(asset.storageKey);
    if (!objectExists) {
      response.status(404).json({
        error: { code: 'FILE_NOT_FOUND', message: 'File not found.', requestId: 'public-files' },
      });
      return;
    }
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const stream = this.storage.createReadStream(asset.storageKey);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}
