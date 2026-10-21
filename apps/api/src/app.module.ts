import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './config/config.module';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { SessionAuthGuard } from './common/guards/session-auth.guard';
import { PrismaModule } from './prisma/prisma.module';
import { AdsModule } from './modules/ads/ads.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ContentModule } from './modules/content/content.module';
import { DictionaryModule } from './modules/dictionary/dictionary.module';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { InquiryModule } from './modules/inquiry/inquiry.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { LeadsModule } from './modules/leads/leads.module';
import { MenusModule } from './modules/menus/menus.module';
import { PiModule } from './modules/pi/pi.module';
import { ProductsModule } from './modules/products/products.module';
import { QuoteModule } from './modules/quote/quote.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SiteModule } from './modules/site/site.module';
import { TagsModule } from './modules/tags/tags.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CommonModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RbacModule,
    MenusModule,
    DictionaryModule,
    SettingsModule,
    SiteModule,
    CategoriesModule,
    ProductsModule,
    TagsModule,
    FilesModule,
    AdsModule,
    ContentModule,
    InquiryModule,
    LeadsModule,
    AnalyticsModule,
    QuoteModule,
    PiModule,
    JobsModule,
    AuditModule,
  ],
  providers: [
    // Order matters: authentication runs before authorization, and both apply
    // to every route unless it is explicitly marked @Public (docs/05 §4).
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
