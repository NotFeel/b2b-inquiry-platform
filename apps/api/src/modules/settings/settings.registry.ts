import type { AppEnv } from '../../config/config.module';

// The built-in settings registry itself lives in `@b2b/contracts` so the API and
// the database seed share one list (docs/21 §4.4). This module only adds the
// environment-seeded defaults, which need the validated runtime config.
export {
  SETTING_DEFINITIONS,
  SETTING_DEFINITION_MAP,
  definitionLabelKey,
  type SettingDefinition,
  type SettingType,
} from '@b2b/contracts';

/** Public defaults that are seeded from the environment on first boot. */
export function envSeededDefaults(env: AppEnv): Record<string, unknown> {
  const seeded: Record<string, unknown> = {};
  if (env.WHATSAPP_BUSINESS_NUMBER) {
    seeded['site.whatsappNumber'] = env.WHATSAPP_BUSINESS_NUMBER;
  }
  seeded['site.batchInquiryLimit'] = env.WHATSAPP_MAX_SELECTED_SKUS;
  seeded['site.analyticsEnabled'] = true;
  seeded['analytics.rawRetentionDays'] = env.ANALYTICS_RAW_RETENTION_DAYS;
  seeded['upload.maxBytes'] = env.UPLOAD_MAX_BYTES;
  seeded['admin.timezone'] = env.SITE_TIMEZONE;
  return seeded;
}
