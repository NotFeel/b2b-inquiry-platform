/**
 * Shared by server data reads and cursor batches. Keep this module dependency
 * free so importing it from the client-safe API module does not pull in locale
 * dictionaries or UI helpers.
 */
export const HOMEPAGE_CACHE_TAGS = ['homepage', 'products', 'categories'] as const;
