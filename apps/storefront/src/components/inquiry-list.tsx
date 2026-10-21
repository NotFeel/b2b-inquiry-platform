'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { buildInquiryMessage, buildWhatsAppUrl } from '@b2b/contracts';
import { Button, IconClipboardList, IconWhatsApp, MediaFrame } from '@b2b/ui';
import { createInquiryIntent, sendAnalyticsEvent } from '../lib/api';
import { getTranslator, localeHref } from '../lib/i18n';
import { normalizeQuantity } from '../lib/inquiry';
import { QuantityControl } from './quantity-control';
import { useSiteConfig } from './site-context';

export interface InquiryItem {
  sku: string;
  name: string;
  slug: string;
  imageUrl?: string | null;
  quantity: number;
}

interface InquiryContextValue {
  items: InquiryItem[];
  limit: number;
  limitReached: boolean;
  ready: boolean;
  add: (item: Omit<InquiryItem, 'quantity'> & { quantity?: number }, quantity?: number) => void;
  remove: (sku: string) => void;
  setQuantity: (sku: string, quantity: number) => void;
  clear: () => void;
  has: (sku: string) => boolean;
  quantityOf: (sku: string) => number;
  sessionId: string;
}

const STORAGE_KEY = 'b2b.inquiry.v1';
const SESSION_KEY = 'b2b.session.v1';

const InquiryContext = createContext<InquiryContextValue | null>(null);

function readSessionId(): string {
  if (typeof window === 'undefined') return '';
  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing && existing.length >= 16) return existing;
  const generated = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  window.localStorage.setItem(SESSION_KEY, generated);
  return generated;
}

/**
 * Batch inquiry list held in the visitor's browser only.
 *
 * Only SKU, display name and slug are stored - no prices, no personal data - and
 * nothing is sent anywhere until the visitor opens WhatsApp (docs/16 §6.7).
 */
export function InquiryProvider({ limit, children }: { limit: number; children: ReactNode }) {
  const [items, setItems] = useState<InquiryItem[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSessionId(readSessionId());
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as InquiryItem[];
        if (Array.isArray(parsed)) {
          setItems(
            parsed
              .filter((item) => typeof item?.sku === 'string' && typeof item?.slug === 'string')
              .map((item) => ({
                sku: item.sku,
                name: String(item.name ?? item.sku),
                slug: item.slug,
                imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : null,
                quantity: normalizeQuantity(Number(item.quantity ?? 1)),
              })),
          );
        }
      }
    } catch {
      setItems([]);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, ready]);

  const add = useCallback(
    (item: Omit<InquiryItem, 'quantity'> & { quantity?: number }, quantity = item.quantity ?? 1) => {
      setItems((current) => {
        const existing = current.find((candidate) => candidate.sku === item.sku);
        if (existing) {
          return current.map((candidate) =>
            candidate.sku === item.sku
              ? {
                  ...candidate,
                  ...item,
                  quantity: normalizeQuantity(candidate.quantity + quantity),
                }
              : candidate,
          );
        }
        if (current.length >= limit) return current;
        return [
          ...current,
          {
            ...item,
            quantity: normalizeQuantity(quantity),
          },
        ];
      });
      void sendAnalyticsEvent({
        eventName: 'product_select',
        sessionId: sessionId || readSessionId(),
        path: typeof window === 'undefined' ? undefined : window.location.pathname,
        context: { skus: [item.sku] },
      });
    },
    [limit, sessionId],
  );

  const remove = useCallback((sku: string) => {
    setItems((current) => current.filter((item) => item.sku !== sku));
  }, []);

  const setQuantity = useCallback((sku: string, quantity: number) => {
    setItems((current) =>
      current.map((item) =>
        item.sku === sku ? { ...item, quantity: normalizeQuantity(quantity) } : item,
      ),
    );
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<InquiryContextValue>(
    () => ({
      items,
      limit,
      limitReached: items.length >= limit,
      ready,
      add,
      remove,
      setQuantity,
      clear,
      has: (sku: string) => items.some((item) => item.sku === sku),
      quantityOf: (sku: string) => items.find((item) => item.sku === sku)?.quantity ?? 0,
      sessionId,
    }),
    [items, limit, ready, add, remove, setQuantity, clear, sessionId],
  );

  return <InquiryContext.Provider value={value}>{children}</InquiryContext.Provider>;
}

export function useInquiry(): InquiryContextValue {
  const context = useContext(InquiryContext);
  if (!context) throw new Error('useInquiry must be used inside <InquiryProvider>.');
  return context;
}

function productUrlFor(item: InquiryItem, locale: string, sourceUrl: string | null): string | undefined {
  if (!sourceUrl) return undefined;
  try {
    return `${new URL(sourceUrl).origin}/${locale}/products/${item.slug}`;
  } catch {
    return undefined;
  }
}

/** Preview text uses the same builder as the API so the two cannot drift. */
export function previewMessage(
  items: InquiryItem[],
  sourceUrl: string | null,
  locale = 'en-US',
  limit = items.length || 20,
): string {
  return buildInquiryMessage({
    items: items.map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      url: productUrlFor(item, locale, sourceUrl),
    })),
    sourceUrl,
    limit,
    locale: locale as 'en-US' | 'zh-CN',
  }).message;
}

interface SubmitOptions {
  locale: string;
  sourceUrl?: string | null;
  whatsappNumber: string | null;
  onMessage?: (message: string) => void;
}

/**
 * Records the intent, then opens WhatsApp with the prefilled message.
 *
 * Opening a new window can be blocked, so a blocked popup falls back to
 * navigating the current tab rather than leaving the visitor stuck.
 */
export async function submitInquiry(
  items: InquiryItem[],
  sessionId: string,
  options: SubmitOptions,
): Promise<{ message: string; opened: boolean }> {
  const result = await createInquiryIntent(
    items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
    sessionId,
    typeof window === 'undefined' ? '/' : window.location.pathname,
    options.locale,
    options.sourceUrl ?? undefined,
  );
  options.onMessage?.(result.prefilledMessage);

  void sendAnalyticsEvent({
    eventName: 'whatsapp_click',
    sessionId,
    path: typeof window === 'undefined' ? undefined : window.location.pathname,
    context: { skus: result.skus },
  });

  const number = result.whatsappNumber ?? options.whatsappNumber;
  if (!number) return { message: result.prefilledMessage, opened: false };

  const url = buildWhatsAppUrl(number, result.prefilledMessage);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    window.location.assign(url);
    return { message: result.prefilledMessage, opened: true };
  }
  return { message: result.prefilledMessage, opened: true };
}

/** Toggle used on product cards and the detail page. */
export function SelectProductButton({
  item,
  variant = 'secondary',
  block = false,
  quantity = 1,
  compact = false,
}: {
  item: Omit<InquiryItem, 'quantity'>;
  variant?: 'primary' | 'secondary';
  block?: boolean;
  quantity?: number;
  compact?: boolean;
}) {
  const { add, remove, has, limitReached, limit } = useInquiry();
  const { locale } = useSiteConfig();
  const t = getTranslator(locale).t;
  const selected = has(item.sku);

  return (
    <Button
      variant={selected ? 'primary' : variant}
      size="sm"
      block={block}
      aria-pressed={selected}
      aria-label={selected ? t('product.selected') : t('product.select')}
      disabled={!selected && limitReached}
      title={!selected && limitReached ? t('inquiry.limitReached', { limit }) : undefined}
      onClick={() => (selected ? remove(item.sku) : add(item, quantity))}
    >
      {selected
        ? t(compact ? 'product.selectedShort' : 'product.selected')
        : t(compact ? 'product.addShort' : 'product.select')}
    </Button>
  );
}

interface InquiryBarProps {
  whatsappNumber: string | null;
  locale: string;
}

/**
 * Fixed inquiry bar shown as soon as at least one product is selected, on every
 * page (docs/16 §6.7 step 2).
 */
export function InquiryBar({ whatsappNumber, locale }: InquiryBarProps) {
  const { items, clear, limit, sessionId } = useInquiry();
  const t = getTranslator(locale).t;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Resolved after mount so the server and client markup stay identical.
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  useEffect(() => {
    setSourceUrl(window.location.href);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="inquiry-bar" role="region" aria-label={t('inquiry.title')}>
      <div className="container-app inquiry-bar-inner">
        <div className="inquiry-bar-summary">
          <strong>{t('inquiry.count', { count: items.length })}</strong>
          <span className="faint small">
            {t('inquiry.limit', { limit })} · {items.map((item) => item.sku).join(', ')}
          </span>
        </div>
        <div className="inquiry-bar-actions">
          <Link className="btn btn-secondary btn-sm" href={localeHref(locale, '/inquiry')}>
            <IconClipboardList size={16} />
            {t('inquiry.viewList')}
          </Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
            {t('inquiry.clear')}
          </button>
          <Button
            variant="whatsapp"
            size="sm"
            loading={busy}
            onClick={() => {
              setError(null);
              setBusy(true);
              void submitInquiry(items, sessionId, { locale, sourceUrl, whatsappNumber, onMessage: setMessage })
                .catch((caught: unknown) => {
                  setError(caught instanceof Error ? caught.message : t('inquiry.error'));
                })
                .finally(() => setBusy(false));
            }}
          >
            <IconWhatsApp size={16} />
            {t('inquiry.askWhatsApp')}
          </Button>
        </div>
      </div>
      {error ? (
        <div className="container-app" style={{ paddingBottom: 'var(--space-3)' }}>
          <div className="notice notice-danger" role="alert">
            {error}
          </div>
        </div>
      ) : null}
      {message ? (
        <div className="container-app" style={{ paddingBottom: 'var(--space-3)' }}>
          <pre className="inquiry-preview small">{message}</pre>
        </div>
      ) : null}
    </div>
  );
}

interface InquiryPanelProps {
  locale: string;
  whatsappNumber: string | null;
}

/**
 * Inquiry list page body: review, remove, preview and open WhatsApp. The list is
 * the same browser-local selection used by the fixed bar.
 */
export function InquiryPanel({ locale, whatsappNumber }: InquiryPanelProps) {
  const { items, remove, clear, setQuantity, limit, limitReached, sessionId } = useInquiry();
  const t = getTranslator(locale).t;
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  useEffect(() => {
    setSourceUrl(window.location.href);
  }, []);

  const preview = message ?? (items.length > 0 ? previewMessage(items, sourceUrl, locale, limit) : '');

  return (
    <div className="stack">
      <div className="panel">
        <div className="row-between">
          <span>
            <strong>{t('inquiry.count', { count: items.length })}</strong>
            <span className="faint small"> · {t('inquiry.limit', { limit })}</span>
          </span>
          <div className="row-tight">
            <span className="faint small">{t('inquiry.localNote')}</span>
            {items.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={clear}>
                {t('inquiry.clear')}
              </Button>
            ) : null}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="state-block">
            <span className="state-icon">
              <IconClipboardList size={22} />
            </span>
            <strong>{t('inquiry.empty')}</strong>
            <span>{t('inquiry.emptyHint')}</span>
            <div className="state-actions">
              <Link className="btn" href={localeHref(locale, '/products')}>
                {t('home.heroCta')}
              </Link>
            </div>
          </div>
        ) : (
          <ul className="inquiry-list">
            {items.map((item) => (
              <li key={item.sku} className="inquiry-item">
                <span className="inquiry-thumb">
                  <MediaFrame
                    src={item.imageUrl ?? null}
                    alt={item.name}
                    ratio="1 / 1"
                    loading="lazy"
                    fallbackLabel={t('product.imageUnavailable')}
                    fallbackSeed={`${item.sku} ${item.name}`}
                  />
                </span>
                <span className="inquiry-item-main">
                  <Link href={localeHref(locale, `/products/${item.slug}`)}>{item.name}</Link>
                  <span className="mono tiny faint">SKU: {item.sku}</span>
                </span>
                <QuantityControl
                  value={item.quantity}
                  onChange={(quantity) => setQuantity(item.sku, quantity)}
                  label={t('inquiry.quantityFor', { name: item.name })}
                  decreaseLabel={t('product.quantityDecrease')}
                  increaseLabel={t('product.quantityIncrease')}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('inquiry.remove')}: ${item.name}`}
                  onClick={() => remove(item.sku)}
                >
                  {t('inquiry.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {limitReached ? <div className="notice notice-warning">{t('inquiry.limitReached', { limit })}</div> : null}
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="panel stack-sm">
          <h2 style={{ fontSize: 'var(--text-lg)' }}>{t('inquiry.reviewTitle')}</h2>
          <p className="field-help">{t('inquiry.preview')}</p>
          <p className="field-help">{t('inquiry.previewNote')}</p>
          <pre className="inquiry-preview">{preview}</pre>
          <div className="row">
            <Button
              variant="whatsapp"
              loading={busy}
              onClick={() => {
                setError(null);
                setBusy(true);
                void submitInquiry(items, sessionId, {
                  locale,
                  sourceUrl,
                  whatsappNumber,
                  onMessage: setMessage,
                })
                  .catch((caught: unknown) => {
                    setError(caught instanceof Error ? caught.message : t('inquiry.error'));
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <IconWhatsApp size={17} />
              {t('inquiry.openWhatsApp')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(preview)
                  .then(() => setCopied(true))
                  .catch(() => setError(t('inquiry.copyFailed')));
              }}
            >
              {copied ? t('inquiry.copied') : t('inquiry.copy')}
            </Button>
          </div>
          <p className="field-help">{t('inquiry.notDelivered')}</p>
        </div>
      ) : null}
    </div>
  );
}
