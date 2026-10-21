import type { MetadataRoute } from 'next';
import { storefrontApi } from '../lib/api';

// The sitemap is generated from public API data only. Draft, unpublished and
// discontinued products never appear, and no price data is involved.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const locales = ['en-US', 'zh-CN'] as const;
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    const languages = Object.fromEntries(locales.map((item) => [item, `${baseUrl}/${item}`]));
    entries.push(
      {
        url: `${baseUrl}/${locale}`,
        changeFrequency: 'weekly',
        priority: 1,
        alternates: { languages },
      },
      {
        url: `${baseUrl}/${locale}/products`,
        changeFrequency: 'daily',
        priority: 0.9,
        alternates: {
          languages: Object.fromEntries(
            locales.map((item) => [item, `${baseUrl}/${item}/products`]),
          ),
        },
      },
      { url: `${baseUrl}/${locale}/factory`, changeFrequency: 'monthly', priority: 0.6 },
      { url: `${baseUrl}/${locale}/quality`, changeFrequency: 'monthly', priority: 0.6 },
      { url: `${baseUrl}/${locale}/faq`, changeFrequency: 'monthly', priority: 0.5 },
    );

    // Only published content pages belong in the sitemap. A draft or missing
    // page must not advertise a URL that resolves to 404.
    try {
      const pages = await storefrontApi.getContentPages();
      for (const page of pages.data) {
        if (page.slug === 'factory' || page.slug === 'quality') continue;
        if (!['factory', 'quality', 'privacy'].includes(page.slug)) {
          continue;
        }
        entries.push({
          url: `${baseUrl}/${locale}/${page.slug}`,
          changeFrequency: 'monthly',
          priority: 0.6,
        });
      }
    } catch {
      // A content API outage must not break the rest of the sitemap.
    }

    try {
      const categories = await storefrontApi.getCategoryTree(locale);
      const flatten = (nodes: typeof categories.data): typeof categories.data =>
        nodes.flatMap((node) => [node, ...flatten(node.children)]);
      for (const category of flatten(categories.data)) {
        entries.push({
          url: `${baseUrl}/${locale}/categories/${category.slug}`,
          changeFrequency: 'weekly',
          priority: 0.7,
        });
      }
    } catch {
      // A category outage must not break sitemap generation.
    }

    try {
      let page = 1;
      let totalPages = 1;
      do {
        const products = await storefrontApi.getProducts({ locale, page, pageSize: 100 });
        totalPages = products.pagination.totalPages;
        for (const product of products.data) {
          entries.push({
            url: `${baseUrl}/${locale}/products/${product.slug}`,
            changeFrequency: 'weekly',
            priority: 0.8,
            alternates: {
              languages: Object.fromEntries(
                locales.map((item) => [item, `${baseUrl}/${item}/products/${product.slug}`]),
              ),
            },
          });
        }
        page += 1;
      } while (page <= Math.min(totalPages, 20));
    } catch {
      // Same here: the static entries above remain valid.
    }
  }

  return entries;
}
