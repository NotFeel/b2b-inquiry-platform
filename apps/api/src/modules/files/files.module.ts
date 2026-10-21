import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { MediaController } from './media.controller';
import { PublicFilesController } from './public-files.controller';

@Module({
  controllers: [FilesController, MediaController, PublicFilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
