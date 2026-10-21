import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { storefrontApi } from '../lib/api';
import { isStorefrontLocale } from '../lib/i18n';

export const metadata: Metadata = {
  title: 'Wholesale product catalogue',
  description: 'Browse our product range and request a quotation on WhatsApp.',
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The site configuration drives the document language and default metadata.
  const requestHeaders = await headers();
  const headerLocale = requestHeaders.get('x-storefront-locale');
  let locale = headerLocale && isStorefrontLocale(headerLocale) ? headerLocale : 'en-US';
  try {
    const config = await storefrontApi.getSiteConfig();
    if (!headerLocale) locale = config.data.defaultLocale;
  } catch {
    if (!headerLocale) locale = 'en-US';
  }
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
