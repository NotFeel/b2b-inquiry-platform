import type { PublicSiteConfig } from '@b2b/contracts';

/**
 * Seed installations use obvious placeholder values. The storefront must not
 * present them as real contact details or a real brand (执行手册 §4.1).
 */
export function isPlaceholderSiteValue(value: string | null | undefined): boolean {
  if (!value) return true;
  return /example\.com|your company|add your|000\s?0000|0{7,}|e2e company/i.test(value);
}

/**
 * Removes placeholder contact/brand values before the config crosses into the
 * React tree. This also prevents them from appearing in the RSC payload.
 */
export function sanitizePublicSiteConfig(config: PublicSiteConfig): PublicSiteConfig {
  return {
    ...config,
    companyName: isPlaceholderSiteValue(config.companyName) ? '' : config.companyName,
    tagline: isPlaceholderSiteValue(config.tagline) ? null : config.tagline,
    contactEmail: isPlaceholderSiteValue(config.contactEmail) ? null : config.contactEmail,
    contactPhone: isPlaceholderSiteValue(config.contactPhone) ? null : config.contactPhone,
    address: isPlaceholderSiteValue(config.address) ? null : config.address,
    whatsappNumber: isPlaceholderSiteValue(config.whatsappNumber)
      ? null
      : config.whatsappNumber,
  };
}
