import { Module } from '@nestjs/common';
import { MenusController } from './menus.controller';
import { MenusService } from './menus.service';
import { PublicMenusController } from './public-menus.controller';

@Module({
  controllers: [MenusController, PublicMenusController],
  providers: [MenusService],
  exports: [MenusService],
})
export class MenusModule {}
