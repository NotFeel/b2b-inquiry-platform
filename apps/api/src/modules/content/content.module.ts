import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ContentController } from './content.controller';
import { ContentOperationsController } from './content-operations.controller';
import { ContentOperationsService } from './content-operations.service';
import { ContentService } from './content.service';
import { PublicContentController } from './public-content.controller';
import { PublicContentOperationsController } from './public-content-operations.controller';

@Module({
  imports: [FilesModule],
  controllers: [
    ContentController,
    ContentOperationsController,
    PublicContentController,
    PublicContentOperationsController,
  ],
  providers: [ContentService, ContentOperationsService],
  exports: [ContentService],
})
export class ContentModule {}
