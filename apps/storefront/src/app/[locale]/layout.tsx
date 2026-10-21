import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteShell } from '../../components/site-shell';
import { storefrontApi } from '../../lib/api';
import { isStorefrontLocale } from '../../lib/i18n';
import { sanitizePublicSiteConfig } from '../../lib/site-config';

interface Props {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!isStorefrontLocale(locale)) notFound();

  // Optional pages are navigation entries only when the administrator has
  // actually published them. The index endpoint avoids probing several URLs and
  // producing 404s for every page render.
  const [config, pages] = await Promise.all([
    storefrontApi.getSiteConfig(),
    storefrontApi.getContentPages(),
  ]);
  const publishedSlugs = new Set(pages.data.map((page) => page.slug));
  return (
    <SiteShell
      config={sanitizePublicSiteConfig(config.data)}
      locale={locale}
      contentPages={{
        // These two routes now render structured content even when the generic
        // intro page is absent, so they are always valid navigation targets.
        factory: true,
        quality: true,
        privacy: publishedSlugs.has('privacy'),
      }}
    >
      {children}
    </SiteShell>
  );
}
