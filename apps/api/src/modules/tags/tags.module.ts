import { Module } from '@nestjs/common';
import { TagsController } from './tags.controller';
import { PublicTagsController } from './public-tags.controller';
import { TagsService } from './tags.service';

@Module({
  controllers: [TagsController, PublicTagsController],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule {}
