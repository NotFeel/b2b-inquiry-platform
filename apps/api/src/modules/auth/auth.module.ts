import { Module } from '@nestjs/common';
import { MenusModule } from '../menus/menus.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [MenusModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
