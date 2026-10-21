'use client';

import { useState } from 'react';
import { Button, IconWhatsApp } from '@b2b/ui';
import { getTranslator } from '../lib/i18n';
import { SelectProductButton, submitInquiry, useInquiry } from './inquiry-list';
import { QuantityControl } from './quantity-control';
import { useSiteConfig } from './site-context';

interface Props {
  locale: string;
  item: { sku: string; name: string; slug: string; imageUrl?: string | null };
  /** The mobile bar is suppressed while the multi-select bar is visible. */
  showMobileBar?: boolean;
}

// Product-level actions (docs/16 §6.6): primary action asks about this single
// product on WhatsApp, secondary adds it to the batch inquiry list.
export function DetailActions({ locale, item, showMobileBar = true }: Props) {
  const t = getTranslator(locale).t;
  const { items, sessionId } = useInquiry();
  const { whatsappNumber } = useSiteConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  const ask = () => {
    setError(null);
    setBusy(true);
    void submitInquiry([{ ...item, quantity }], sessionId, {
      locale,
      sourceUrl: typeof window === 'undefined' ? null : window.location.href,
      whatsappNumber,
    })
      .then((result) => {
        if (!result.opened) setError(t('inquiry.error'));
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t('inquiry.error')))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className="detail-quantity">
        <span className="detail-quantity-label">{t('product.quantityLabel')}</span>
        <QuantityControl
          value={quantity}
          onChange={setQuantity}
          label={t('product.quantityValue', { name: item.name })}
          decreaseLabel={t('product.quantityDecrease')}
          increaseLabel={t('product.quantityIncrease')}
        />
        <span className="field-help">{t('product.quantityHint')}</span>
      </div>
      <div className="detail-actions">
        <Button variant="whatsapp" size="lg" loading={busy} onClick={ask}>
          <IconWhatsApp size={18} />
          {t('product.askThisProduct')}
        </Button>
        <SelectProductButton item={item} variant="secondary" quantity={quantity} />
      </div>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}

      {showMobileBar && items.length === 0 ? (
        <div className="mobile-inquiry-cta">
          <Button variant="whatsapp" loading={busy} onClick={ask}>
            <IconWhatsApp size={18} />
            {t('product.askWhatsApp')}
          </Button>
          <SelectProductButton item={item} variant="secondary" quantity={quantity} />
        </div>
      ) : null}
    </>
  );
}
