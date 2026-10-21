'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PublicSiteConfig } from '@b2b/contracts';
import { IconChevronRight, IconClipboardList, IconClose, IconMenu, IconSearch } from '@b2b/ui';
import { getTranslator, localeHref } from '../lib/i18n';
import type { OptionalContentPages } from '../lib/content';
import { isPlaceholderSiteValue } from '../lib/site-config';
import { useInquiry } from './inquiry-list';
import { WhatsAppCta } from './whatsapp-cta';

interface Props {
  config: Pick<PublicSiteConfig, 'companyName' | 'logoUrl'>;
  locale: string;
  contentPages: OptionalContentPages;
}

/**
 * Storefront header: 72px, 1280px container, nav + search + inquiry entry.
 * Below 1024px the nav collapses into a panel and search becomes an icon that
 * opens a full-width search row (docs/16 §6.1).
 */
export function SiteHeader({ config, locale, contentPages }: Props) {
  const t = getTranslator(locale).t;
  const pathname = usePathname();
  const { items } = useInquiry();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuId = useId();
  const searchId = useId();

  const navItems = [
    { href: '/', label: t('site.nav.home') },
    { href: '/products', label: t('site.nav.products') },
    ...(contentPages.factory ? [{ href: '/factory', label: t('site.nav.factory') }] : []),
    ...(contentPages.quality ? [{ href: '/quality', label: t('site.nav.quality') }] : []),
    { href: '/faq', label: t('site.nav.faq') },
  ];

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen && !searchOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      setSearchOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen, searchOpen]);

  const isCurrent = (href: string) => {
    const target = localeHref(locale, href);
    if (href === '/') return pathname === target;
    return pathname === target || pathname.startsWith(`${target}/`);
  };

  const brandName = isPlaceholderSiteValue(config.companyName)
    ? t('site.brandFallback')
    : config.companyName;
  const initials = brandName.trim().slice(0, 1).toUpperCase();

  return (
    <header className="site-header">
      <div className="container-app site-header-inner">
        <Link className="site-brand" href={localeHref(locale, '/')} aria-label={brandName}>
          {config.logoUrl ? (
            <img src={config.logoUrl} alt={brandName} />
          ) : (
            <span className="site-brand-mark" aria-hidden="true">
              {initials}
            </span>
          )}
          <span className="truncate" style={{ maxWidth: 220 }}>
            {brandName}
          </span>
        </Link>

        <nav className="site-nav" aria-label={t('site.nav.products')}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={localeHref(locale, item.href)}
              aria-current={isCurrent(item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form
          className="site-search"
          action={localeHref(locale, '/products')}
          method="get"
          role="search"
        >
          <label className="visually-hidden" htmlFor="site-search-input">
            {t('site.search.label')}
          </label>
          <input
            id="site-search-input"
            className="input"
            type="search"
            name="q"
            placeholder={t('site.search.placeholder')}
            maxLength={120}
          />
          <button className="btn" type="submit">
            <IconSearch size={16} />
            <span className="visually-hidden">{t('site.search.submit')}</span>
          </button>
        </form>

        <div className="site-actions">
          <WhatsAppCta locale={locale} />
          <button
            type="button"
            className="icon-button header-icon-button"
            aria-label={t('site.search.label')}
            aria-expanded={searchOpen}
            aria-controls={searchId}
            onClick={() => {
              setSearchOpen((value) => !value);
              setMenuOpen(false);
            }}
          >
            <IconSearch size={20} />
          </button>
          <Link className="inquiry-entry" href={localeHref(locale, '/inquiry')}>
            <IconClipboardList size={17} />
            <span className="visually-hidden">{t('site.nav.inquiryList')}</span>
            <span aria-hidden="true" className="inquiry-count" data-empty={items.length === 0}>
              {items.length}
            </span>
          </Link>
          <button
            type="button"
            className="icon-button header-icon-button"
            aria-label={menuOpen ? t('site.nav.closeMenu') : t('site.nav.toggleMenu')}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => {
              setMenuOpen((value) => !value);
              setSearchOpen(false);
            }}
          >
            {menuOpen ? <IconClose size={20} /> : <IconMenu size={20} />}
          </button>
        </div>
      </div>

      {searchOpen ? (
        <div className="container-app site-search-panel" id={searchId}>
          <form
            className="site-search"
            action={localeHref(locale, '/products')}
            method="get"
            role="search"
          >
            <label className="visually-hidden" htmlFor="site-search-mobile">
              {t('site.search.label')}
            </label>
            <input
              id="site-search-mobile"
              className="input"
              type="search"
              name="q"
              placeholder={t('site.search.placeholder')}
              maxLength={120}
            />
            <button className="btn" type="submit">
              <IconSearch size={16} />
              <span>{t('site.search.submit')}</span>
            </button>
          </form>
        </div>
      ) : null}

      {menuOpen ? (
        <div className="container-app site-nav-panel" id={menuId}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={localeHref(locale, item.href)}
              aria-current={isCurrent(item.href) ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
              <IconChevronRight size={16} style={{ marginLeft: 'auto' }} />
            </Link>
          ))}
          <div className="row" style={{ marginTop: 'var(--space-3)' }}>
            <WhatsAppCta locale={locale} className="btn btn-whatsapp btn-sm" />
          </div>
        </div>
      ) : null}
    </header>
  );
}
