'use client';

import Link from 'next/link';
import { buildWhatsAppUrl } from '@b2b/contracts';
import { IconWhatsApp } from '@b2b/ui';
import { sendAnalyticsEvent } from '../lib/api';
import { getTranslator, localeHref } from '../lib/i18n';
import { useInquiry } from './inquiry-list';
import { useSiteConfig } from './site-context';

interface Props {
  locale: string;
  className?: string;
  label?: string;
  iconSize?: number;
  /** Optional prefilled message; the WhatsApp number always comes from settings. */
  message?: string;
  /** Show the label next to the icon. */
  withLabel?: boolean;
}

/**
 * Direct WhatsApp entry used by the header and hero. It never claims that a
 * message was sent - the event is a click, and the visitor still has to press
 * send in WhatsApp (docs/09).
 */
export function WhatsAppCta({
  locale,
  className = 'header-whatsapp',
  label,
  iconSize = 18,
  message,
  withLabel = true,
}: Props) {
  const t = getTranslator(locale).t;
  const { whatsappNumber } = useSiteConfig();
  const { sessionId } = useInquiry();
  const text = label ?? t('site.whatsappCta');
  const fallbackText = t('site.inquiryCta');

  if (!whatsappNumber) {
    return (
      <Link className={className} href={localeHref(locale, '/inquiry')} aria-label={fallbackText}>
        <IconWhatsApp size={iconSize} />
        {withLabel ? <span>{fallbackText}</span> : null}
      </Link>
    );
  }

  let href: string;
  try {
    href = buildWhatsAppUrl(whatsappNumber, message ?? t('site.whatsappMessage'));
  } catch {
    return (
      <Link className={className} href={localeHref(locale, '/inquiry')} aria-label={fallbackText}>
        <IconWhatsApp size={iconSize} />
        {withLabel ? <span>{fallbackText}</span> : null}
      </Link>
    );
  }

  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={text}
      onClick={() => {
        void sendAnalyticsEvent({
          eventName: 'whatsapp_click',
          sessionId,
          path: typeof window === 'undefined' ? undefined : window.location.pathname,
          context: { locale },
        });
      }}
    >
      <IconWhatsApp size={iconSize} />
      {withLabel ? <span>{text}</span> : null}
    </a>
  );
}
