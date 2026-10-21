import { Controller, Get, Query } from '@nestjs/common';
import { publicLocaleQuerySchema } from '@b2b/validation';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { MenusService } from './menus.service';

// Storefront navigation is public and never permission-filtered.
@Controller('public/menus')
export class PublicMenusController {
  constructor(private readonly menus: MenusService) {}

  @Public()
  @Get()
  async list(@Query(zodPipe(publicLocaleQuerySchema)) query: { locale: string }) {
    const tree = await this.menus.listTree({ locale: query.locale, includeDisabled: false });
    return {
      data: tree.map((node) => ({
        id: node.id,
        code: node.code,
        label: node.label,
        route: node.route,
        external: node.external,
        children: node.children.map((child) => ({
          id: child.id,
          code: child.code,
          label: child.label,
          route: child.route,
          external: child.external,
          children: [],
        })),
      })),
    };
  }
}
