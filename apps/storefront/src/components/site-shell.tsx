import type { PublicSiteConfig } from '@b2b/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconWhatsApp } from '@b2b/ui';
import { getTranslator, localeHref } from '../lib/i18n';
import { isPlaceholderSiteValue } from '../lib/site-config';
import { AnalyticsTracker } from './analytics-tracker';
import { InquiryBar, InquiryProvider } from './inquiry-list';
import { SiteConfigProvider } from './site-context';
import { SiteHeader } from './site-header';
import { SiteMain } from './site-main';
import { WhatsAppCta } from './whatsapp-cta';
import type { OptionalContentPages } from '../lib/content';

interface Props {
  config: PublicSiteConfig;
  locale: string;
  contentPages: OptionalContentPages;
  children: ReactNode;
}

export function SiteFooter({
  config,
  locale,
  contentPages,
}: {
  config: PublicSiteConfig;
  locale: string;
  contentPages: OptionalContentPages;
}) {
  const t = getTranslator(locale).t;
  const year = new Date().getFullYear();
  const isPlaceholder = isPlaceholderSiteValue;
  const brandName = isPlaceholder(config.companyName)
    ? t('site.brandFallback')
    : config.companyName;
  const contactEmail = isPlaceholder(config.contactEmail) ? null : config.contactEmail;
  const contactPhone = isPlaceholder(config.contactPhone) ? null : config.contactPhone;
  const address = isPlaceholder(config.address) ? null : config.address;
  const whatsappNumber = isPlaceholder(config.whatsappNumber) ? null : config.whatsappNumber;
  const hasContactDetails = Boolean(contactEmail || contactPhone || address);

  return (
    <footer className="site-footer">
      <div className="container-app">
        <div className="site-footer-grid">
          <div>
            <div className="site-footer-brand">
              <span className="site-brand-mark" aria-hidden="true">
                {brandName.slice(0, 1).toUpperCase()}
              </span>
              <span>{brandName}</span>
            </div>
            {!isPlaceholder(config.tagline) && locale === config.defaultLocale ? (
              <p>{config.tagline}</p>
            ) : null}
            <p className="small">{t('site.footer.pricesNote')}</p>
            {whatsappNumber ? (
              <p className="row-tight small">
                <IconWhatsApp size={16} />
                <span>+{whatsappNumber}</span>
              </p>
            ) : null}
            <div style={{ marginTop: 'var(--space-4)' }}>
              <WhatsAppCta
                locale={locale}
                className="btn btn-whatsapp btn-sm"
                label={t('site.whatsappCta')}
              />
            </div>
          </div>
          <div>
            <h2>{t('site.footer.catalogueHeading')}</h2>
            <ul>
              <li>
                <Link href={localeHref(locale, '/products')}>{t('site.nav.products')}</Link>
              </li>
              <li>
                <Link href={localeHref(locale, '/categories')}>{t('site.nav.categories')}</Link>
              </li>
              <li>
                <Link href={localeHref(locale, '/inquiry')}>{t('site.nav.inquiryList')}</Link>
              </li>
            </ul>
          </div>
          {hasContactDetails ? (
            <div>
              <h2>{t('site.footer.contactHeading')}</h2>
              <ul>
                {contactEmail ? (
                  <li>
                    <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                  </li>
                ) : null}
                {contactPhone ? <li>{contactPhone}</li> : null}
                {address ? <li>{address}</li> : null}
              </ul>
            </div>
          ) : null}
          <div>
            <h2>{t('site.footer.companyHeading')}</h2>
            <ul>
              {contentPages.factory ? (
                <li>
                  <Link href={localeHref(locale, '/factory')}>{t('site.nav.factory')}</Link>
                </li>
              ) : null}
              {contentPages.quality ? (
                <li>
                  <Link href={localeHref(locale, '/quality')}>{t('site.nav.quality')}</Link>
                </li>
              ) : null}
              <li>
                <Link href={localeHref(locale, '/faq')}>{t('site.nav.faq')}</Link>
              </li>
              {contentPages.privacy ? (
                <li>
                  <Link href={localeHref(locale, '/privacy')}>{t('site.nav.privacy')}</Link>
                </li>
              ) : null}
              {config.legalLinks.map((link) => (
                <li key={link.url}>
                  <a href={link.url}>{link.label}</a>
                </li>
              ))}
              {config.socialLinks.map((link) => (
                <li key={link.url}>
                  <a href={link.url} rel="noopener noreferrer" target="_blank">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="site-footer-bottom">
          <span>
            © {year} {brandName}. {t('site.footer.rights')}
          </span>
        </div>
      </div>
    </footer>
  );
}

export function SiteShell({ config, locale, contentPages, children }: Props) {
  const t = getTranslator(locale).t;
  return (
    <SiteConfigProvider
      value={{
        locale,
        whatsappNumber: isPlaceholderSiteValue(config.whatsappNumber)
          ? null
          : config.whatsappNumber,
        companyName: isPlaceholderSiteValue(config.companyName)
          ? t('site.brandFallback')
          : config.companyName,
      }}
    >
      <InquiryProvider limit={config.batchInquiryLimit}>
        <div className="site">
          <a className="skip-link" href="#main">
            {t('site.skipToContent')}
          </a>
          <SiteHeader
            config={{ companyName: config.companyName, logoUrl: config.logoUrl }}
            locale={locale}
            contentPages={contentPages}
          />
          <SiteMain>{children}</SiteMain>
          <SiteFooter config={config} locale={locale} contentPages={contentPages} />
          <InquiryBar whatsappNumber={config.whatsappNumber} locale={locale} />
          <AnalyticsTracker enabled={config.analyticsEnabled} />
        </div>
      </InquiryProvider>
    </SiteConfigProvider>
  );
}
