'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Button, Input, PageHeader, Select, useToast } from '@b2b/ui';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { QuotationProductPickerDialog } from '../../../../components/quotation-product-picker-dialog';
import { useSession } from '../../../../components/session-provider';
import { AdminApiError } from '../../../../lib/admin-api';
import {
  quotationOrderApi,
  type CalculatorInput,
  type CalculatorProduct,
  type CalculationResult,
  type QuotationConfig,
} from '../../../../lib/quotation-order-api';

function SimpleField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

type ItemDraft = {
  productId: string;
  quantity: string;
  markupPercent: string;
  cartonCount: string;
  unitsPerCarton: string;
  cartonLengthCm: string;
  cartonWidthCm: string;
  cartonHeightCm: string;
  cartonGrossWeightKg: string;
};
type FeeDraft = { feeTypeCode: string; name: string; amountCny: string };
const blankItem = (): ItemDraft => ({
  productId: '',
  quantity: '1',
  markupPercent: '20',
  cartonCount: '',
  unitsPerCarton: '',
  cartonLengthCm: '',
  cartonWidthCm: '',
  cartonHeightCm: '',
  cartonGrossWeightKg: '',
});

function isValidFreightRate(value: string): boolean {
  const normalized = value.trim();
  return /^\d{1,16}(?:\.\d{1,8})?$/.test(normalized) && /[1-9]/.test(normalized);
}

/** Strip insignificant fractional zeros for display without rounding the value. */
function formatCalculatedValue(value: string): string {
  if (!/^-?\d+\.\d+$/.test(value)) return value;
  const trimmed = value.replace(/0+$/, '');
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

export default function QuotationCalculatorPage() {
  const { t, locale, can } = useSession();
  const breadcrumb = useBreadcrumb();
  const toast = useToast();
  const [config, setConfig] = useState<QuotationConfig | null>(null);
  const [chosenProducts, setChosenProducts] = useState<Record<string, CalculatorProduct>>({});
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [customers, setCustomers] = useState<
    { id: string; phoneE164: string; displayName: string | null; countryCode: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [title, setTitle] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState('0.1380');
  const [exchangeRateDate, setExchangeRateDate] = useState(new Date().toISOString().slice(0, 10));
  const [freightBillingMethod, setFreightBillingMethod] = useState<'CBM' | 'KG'>('CBM');
  const [volumetricDivisorItemId, setVolumetricDivisorItemId] = useState('');
  const [cbmRatePerCbm, setCbmRatePerCbm] = useState('');
  const [kgRatePerKg, setKgRatePerKg] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('0');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('US');
  const [recipient, setRecipient] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [fees, setFees] = useState<FeeDraft[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [draggedProductId, setDraggedProductId] = useState<string | null>(null);
  const [dragOverProductId, setDragOverProductId] = useState<string | null>(null);
  const [previewRatesInvalid, setPreviewRatesInvalid] = useState(false);

  const canCalculate = can('quotation.calculate');
  const canSave = can('quotation.create');
  const canCreateOrder = can('order.create');
  const canReadFreightAllocation = can('quotation.cost.read') || can('product.cost.read');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextConfig, nextCustomers] = await Promise.all([
        quotationOrderApi.config(locale),
        can('customer.read') ? quotationOrderApi.customers() : Promise.resolve({ data: [] }),
      ]);
      setConfig(nextConfig);
      setVolumetricDivisorItemId(
        (current) => current || nextConfig.volumetricDivisors[0]?.id || '',
      );
      setCustomers(nextCustomers.data);
      setCurrencyCode((current) =>
        nextConfig.currencies.some((currency) => currency.code === current)
          ? current
          : (nextConfig.currencies[0]?.code ?? 'CNY'),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('quotationCenter.loadError'));
    } finally {
      setLoading(false);
    }
  }, [can, locale, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeItem = (index: number, key: keyof ItemDraft, value: string) => {
    setResult(null);
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (index !== itemIndex) return item;
        if (key !== 'productId') return { ...item, [key]: value };
        return { ...item, [key]: value };
      }),
    );
  };

  const addProducts = (selectedProducts: CalculatorProduct[]) => {
    setChosenProducts((current) => ({
      ...current,
      ...Object.fromEntries(selectedProducts.map((product) => [product.id, product])),
    }));
    setItems((current) => {
      const existingIds = new Set(current.map((item) => item.productId));
      const nextItems = [...current];
      for (const product of selectedProducts) {
        if (existingIds.has(product.id)) continue;
        const item = blankItem();
        item.productId = product.id;
        item.cartonLengthCm = product.packaging.cartonLengthCm ?? '';
        item.cartonWidthCm = product.packaging.cartonWidthCm ?? '';
        item.cartonHeightCm = product.packaging.cartonHeightCm ?? '';
        item.cartonGrossWeightKg = product.packaging.cartonGrossWeightKg ?? '';
        item.unitsPerCarton = product.packaging.unitsPerCarton?.toString() ?? '';
        item.cartonCount = product.packaging.unitsPerCarton
          ? String(Math.ceil(1 / product.packaging.unitsPerCarton))
          : '';
        item.cartonCount = '';
        nextItems.push(item);
      }
      return nextItems;
    });
    setResult(null);
  };

  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    setItems((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (!moved) return current;
      next.splice(to, 0, moved);
      return next;
    });
    setResult(null);
  };

  const buildInput = (): CalculatorInput => ({
    title: title.trim(),
    customerId: customerId || null,
    customer: {
      companyName: companyName.trim(),
      contactName: contactName.trim(),
      phoneE164: phone.trim(),
      countryCode,
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(recipient && city && addressLine
        ? {
            shippingAddress: {
              recipient: recipient.trim(),
              countryCode,
              region: region.trim(),
              city: city.trim(),
              postalCode: postalCode.trim(),
              line1: addressLine.trim(),
              line2: '',
            },
          }
        : {}),
    },
    orderDate,
    currencyCode,
    exchangeRate: currencyCode === 'CNY' ? '1' : exchangeRate,
    exchangeRateDate,
    freightBillingMethod,
    freightCurrencyCode: 'CNY',
    cbmRatePerCbm,
    kgRatePerKg,
    volumetricDivisorItemId,
    deliveryFeeCny: deliveryFee,
    items: items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      markupPercent: item.markupPercent,
      cartonCount: item.cartonCount ? Number(item.cartonCount) : null,
      unitsPerCarton: item.unitsPerCarton ? Number(item.unitsPerCarton) : null,
      cartonLengthCm: item.cartonLengthCm || null,
      cartonWidthCm: item.cartonWidthCm || null,
      cartonHeightCm: item.cartonHeightCm || null,
      cartonGrossWeightKg: item.cartonGrossWeightKg || null,
    })),
    fees: fees.map((fee) => ({ ...fee })),
  });

  const runPreview = async () => {
    const input = buildInput();
    if (!isValidFreightRate(input.cbmRatePerCbm) || !isValidFreightRate(input.kgRatePerKg)) {
      setPreviewRatesInvalid(true);
      setResult(null);
      setError('');
      return;
    }
    setPreviewRatesInvalid(false);
    setSaving(true);
    setError('');
    try {
      setResult(await quotationOrderApi.preview(input));
    } catch (cause) {
      setResult(null);
      setError(
        cause instanceof AdminApiError
          ? `${cause.message} (${cause.code})`
          : cause instanceof Error
            ? cause.message
            : t('quotationCenter.calculationError'),
      );
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await quotationOrderApi.saveDraft(buildInput());
      toast.success(t('quotationCenter.draftSaved', { number: saved.quotationNo }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('quotationCenter.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const createOrder = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await quotationOrderApi.createOrder(buildInput());
      toast.success(t('quotationCenter.orderCreated', { number: saved.orderNo }));
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? `${cause.message} (${cause.code})`
          : cause instanceof Error
            ? cause.message
            : t('quotationCenter.saveError'),
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="stack">
        <PageHeader
          breadcrumb={breadcrumb}
          title={t('quotationCenter.title')}
          description={t('quotationCenter.description')}
        />
        <section className="panel" aria-live="polite">
          {t('quotationCenter.loading')}
        </section>
      </div>
    );

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('quotationCenter.title')}
        description={t('quotationCenter.description')}
        actions={
          <Button variant="secondary" onClick={() => void load()}>
            {t('quotationCenter.refresh')}
          </Button>
        }
      />
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {!config ? (
        <section className="panel" role="alert">
          {t('quotationCenter.configUnavailable')}
        </section>
      ) : (
        <>
          <section className="panel stack-sm">
            <h2>{t('quotationCenter.customerSection')}</h2>
            {customers.length ? (
              <SimpleField label={t('quotationCenter.existingCustomer')}>
                <Select
                  value={customerId}
                  onChange={(event) => {
                    const id = event.target.value;
                    setCustomerId(id);
                    const selected = customers.find((customer) => customer.id === id);
                    if (selected) {
                      setCompanyName(selected.displayName ?? '');
                      setPhone(selected.phoneE164);
                      setCountryCode(selected.countryCode ?? countryCode);
                    }
                  }}
                  placeholder={t('quotationCenter.newCustomer')}
                  options={customers.map((customer) => ({
                    value: customer.id,
                    label: `${customer.displayName || customer.phoneE164} · ${customer.phoneE164}`,
                  }))}
                />
              </SimpleField>
            ) : null}
            <div className="form-grid">
              <SimpleField label={t('quotationCenter.titleField')}>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={180}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.company')}>
                <Input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  maxLength={180}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.contact')}>
                <Input
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  maxLength={160}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.phone')}>
                <Input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  maxLength={24}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.email')}>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={254}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.countryCode')}>
                <Input
                  value={countryCode}
                  onChange={(event) => setCountryCode(event.target.value.toUpperCase().slice(0, 2))}
                  maxLength={2}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.orderDate')}>
                <Input
                  type="date"
                  value={orderDate}
                  onChange={(event) => setOrderDate(event.target.value)}
                />
              </SimpleField>
            </div>
            <h3>{t('quotationCenter.shippingAddress')}</h3>
            <div className="form-grid">
              <SimpleField label={t('quotationCenter.recipient')}>
                <Input
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  maxLength={160}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.city')}>
                <Input
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  maxLength={120}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.region')}>
                <Input
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  maxLength={120}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.postalCode')}>
                <Input
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                  maxLength={40}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.addressLine')}>
                <Input
                  value={addressLine}
                  onChange={(event) => setAddressLine(event.target.value)}
                  maxLength={240}
                />
              </SimpleField>
            </div>
          </section>

          <section className="panel stack-sm">
            <div className="row-between">
              <h2>{t('quotationCenter.itemsSection')}</h2>
              <Button variant="secondary" onClick={() => setProductPickerOpen(true)}>
                {t('quotationCenter.addItem')}
              </Button>
            </div>
            <div className="table-scroll" style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: '1800px', width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col">{t('quotationCenter.productImage')}</th>
                    <th scope="col">SKU / {t('quotationCenter.productName')}</th>
                    <th scope="col">{t('quotationCenter.internalPrice')}</th>
                    <th scope="col">{t('quotationCenter.quantity')}</th>
                    <th scope="col">{t('quotationCenter.markup')}</th>
                    <th scope="col">{t('quotationCenter.cartons')}</th>
                    <th scope="col">{t('quotationCenter.unitsPerCarton')}</th>
                    <th scope="col">{t('quotationCenter.dimensions')}</th>
                    <th scope="col">{t('quotationCenter.cartonWeight')}</th>
                    <th scope="col">{t('quotationCenter.unitPriceCny')}</th>
                    <th scope="col">{t('quotationCenter.cartonVolumeCbm')}</th>
                    <th scope="col">{t('quotationCenter.totalCbm')}</th>
                    <th scope="col">{t('quotationCenter.cartonVolumeWeightKg')}</th>
                    <th scope="col">{t('quotationCenter.totalVolumeWeightKg')}</th>
                    <th scope="col">{t('quotationCenter.totalGrossWeightKg')}</th>
                    <th scope="col">{t('quotationCenter.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={16}>{t('quotationCenter.emptyItems')}</td>
                    </tr>
                  ) : (
                    items.map((item, index) => {
                      const product = chosenProducts[item.productId];
                      const calculatedItem = result?.items[index];
                      return (
                        <tr
                          key={item.productId}
                          className="quotation-calculator-row"
                          draggable
                          tabIndex={0}
                          aria-label={t('quotationCenter.dragProduct', {
                            sku: product?.sku ?? '',
                          })}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === 'ArrowUp') {
                              event.preventDefault();
                              moveItem(index, index - 1);
                            } else if (event.key === 'ArrowDown') {
                              event.preventDefault();
                              moveItem(index, index + 1);
                            }
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', item.productId);
                            setDraggedProductId(item.productId);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setDragOverProductId(item.productId);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const draggedId = event.dataTransfer.getData('text/plain');
                            const from = items.findIndex((row) => row.productId === draggedId);
                            if (from >= 0) moveItem(from, index);
                            setDraggedProductId(null);
                            setDragOverProductId(null);
                          }}
                          onDragEnd={() => {
                            setDraggedProductId(null);
                            setDragOverProductId(null);
                          }}
                          style={{
                            opacity: draggedProductId === item.productId ? 0.55 : 1,
                            outline:
                              dragOverProductId === item.productId
                                ? '2px solid var(--color-primary)'
                                : undefined,
                          }}
                        >
                          <td>
                            {product?.imageUrl ? (
                              <Image
                                src={product.imageUrl}
                                alt={product.imageAlt}
                                width={56}
                                height={56}
                                unoptimized
                                style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                              />
                            ) : (
                              <span aria-label={t('quotationCenter.noImage')}>—</span>
                            )}
                          </td>
                          <td>
                            <strong>{product?.sku ?? item.productId}</strong>
                            <br />
                            {product?.name ?? '—'}
                          </td>
                          <td>{product?.costCny ? `¥${product.costCny}` : '—'}</td>
                          <td>
                            <Input
                              inputMode="decimal"
                              aria-label={t('quotationCenter.quantityForSku', {
                                sku: product?.sku ?? '',
                              })}
                              value={item.quantity}
                              onChange={(event) =>
                                changeItem(index, 'quantity', event.target.value)
                              }
                            />
                          </td>
                          <td>
                            <Input
                              inputMode="decimal"
                              aria-label={t('quotationCenter.markupForSku', {
                                sku: product?.sku ?? '',
                              })}
                              value={item.markupPercent}
                              onChange={(event) =>
                                changeItem(index, 'markupPercent', event.target.value)
                              }
                            />
                          </td>
                          <td>
                            <Input
                              inputMode="numeric"
                              aria-label={t('quotationCenter.cartonsForSku', {
                                sku: product?.sku ?? '',
                              })}
                              value={item.cartonCount}
                              onChange={(event) =>
                                changeItem(index, 'cartonCount', event.target.value)
                              }
                            />
                          </td>
                          <td>
                            <Input
                              inputMode="numeric"
                              aria-label={t('quotationCenter.unitsPerCartonForSku', {
                                sku: product?.sku ?? '',
                              })}
                              value={item.unitsPerCarton}
                              onChange={(event) =>
                                changeItem(index, 'unitsPerCarton', event.target.value)
                              }
                            />
                          </td>
                          <td>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 64px)',
                                gap: '4px',
                              }}
                            >
                              {(
                                [
                                  ['cartonLengthCm', 'quotationCenter.lengthCm'],
                                  ['cartonWidthCm', 'quotationCenter.widthCm'],
                                  ['cartonHeightCm', 'quotationCenter.heightCm'],
                                ] as const
                              ).map(([key, label]) => (
                                <Input
                                  key={key}
                                  inputMode="decimal"
                                  aria-label={t(label)}
                                  value={item[key]}
                                  onChange={(event) => changeItem(index, key, event.target.value)}
                                />
                              ))}
                            </div>
                          </td>
                          <td>
                            <Input
                              inputMode="decimal"
                              aria-label={t('quotationCenter.cartonWeightForSku', {
                                sku: product?.sku ?? '',
                              })}
                              value={item.cartonGrossWeightKg}
                              onChange={(event) =>
                                changeItem(index, 'cartonGrossWeightKg', event.target.value)
                              }
                            />
                          </td>
                          <td>
                            {calculatedItem
                              ? `¥${formatCalculatedValue(calculatedItem.unitSalePriceCny)}`
                              : '—'}
                          </td>
                          <td>
                            {calculatedItem
                              ? formatCalculatedValue(calculatedItem.cartonVolumeCbm)
                              : '—'}
                          </td>
                          <td>
                            {calculatedItem ? formatCalculatedValue(calculatedItem.totalCbm) : '—'}
                          </td>
                          <td>
                            {calculatedItem
                              ? formatCalculatedValue(calculatedItem.cartonVolumeWeightKg)
                              : '—'}
                          </td>
                          <td>
                            {calculatedItem
                              ? formatCalculatedValue(calculatedItem.totalVolumeWeightKg)
                              : '—'}
                          </td>
                          <td>
                            {calculatedItem
                              ? formatCalculatedValue(calculatedItem.totalGrossWeightKg)
                              : '—'}
                          </td>
                          <td>
                            <div className="button-row">
                              <Button
                                variant="danger"
                                aria-label={t('quotationCenter.removeSku', {
                                  sku: product?.sku ?? '',
                                })}
                                onClick={() => {
                                  setItems((current) =>
                                    current.filter((_, itemIndex) => itemIndex !== index),
                                  );
                                  setResult(null);
                                }}
                              >
                                {t('quotationCenter.removeItem')}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel stack-sm">
            <h2>{t('quotationCenter.pricingSection')}</h2>
            <div className="form-grid">
              <SimpleField label={t('quotationCenter.currency')}>
                <Select
                  value={currencyCode}
                  onChange={(event) => {
                    setCurrencyCode(event.target.value);
                    setResult(null);
                  }}
                  options={config.currencies.map((currency) => ({
                    value: currency.code,
                    label: currency.label,
                  }))}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.exchangeRate')}>
                <Input
                  inputMode="decimal"
                  disabled={currencyCode === 'CNY'}
                  value={currencyCode === 'CNY' ? '1' : exchangeRate}
                  onChange={(event) => {
                    setExchangeRate(event.target.value);
                    setResult(null);
                  }}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.exchangeRateDate')}>
                <Input
                  type="date"
                  value={exchangeRateDate}
                  onChange={(event) => {
                    setExchangeRateDate(event.target.value);
                    setResult(null);
                  }}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.freightMethod')}>
                <Select
                  value={freightBillingMethod}
                  onChange={(event) => {
                    setFreightBillingMethod(event.target.value as 'CBM' | 'KG');
                    setResult(null);
                  }}
                  options={[
                    { value: 'CBM', label: t('quotationCenter.billingByCbm') },
                    { value: 'KG', label: t('quotationCenter.billingByKg') },
                  ]}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.volumetricDivisor')}>
                <Select
                  value={volumetricDivisorItemId}
                  onChange={(event) => {
                    setVolumetricDivisorItemId(event.target.value);
                    setResult(null);
                  }}
                  options={config.volumetricDivisors.map((option) => ({
                    value: option.id,
                    label: option.label,
                  }))}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.cbmRatePerCbm')}>
                <Input
                  inputMode="decimal"
                  required
                  aria-invalid={
                    previewRatesInvalid && !isValidFreightRate(cbmRatePerCbm) ? true : undefined
                  }
                  aria-describedby={previewRatesInvalid ? 'quotation-rate-error' : undefined}
                  value={cbmRatePerCbm}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCbmRatePerCbm(value);
                    setPreviewRatesInvalid(
                      !isValidFreightRate(value) || !isValidFreightRate(kgRatePerKg),
                    );
                    setError('');
                    setResult(null);
                  }}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.kgRatePerKg')}>
                <Input
                  inputMode="decimal"
                  required
                  aria-invalid={
                    previewRatesInvalid && !isValidFreightRate(kgRatePerKg) ? true : undefined
                  }
                  aria-describedby={previewRatesInvalid ? 'quotation-rate-error' : undefined}
                  value={kgRatePerKg}
                  onChange={(event) => {
                    const value = event.target.value;
                    setKgRatePerKg(value);
                    setPreviewRatesInvalid(
                      !isValidFreightRate(cbmRatePerCbm) || !isValidFreightRate(value),
                    );
                    setError('');
                    setResult(null);
                  }}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.deliveryFee')}>
                <Input
                  inputMode="decimal"
                  value={deliveryFee}
                  onChange={(event) => {
                    setDeliveryFee(event.target.value);
                    setResult(null);
                  }}
                />
              </SimpleField>
            </div>
            {previewRatesInvalid ? (
              <p id="quotation-rate-error" className="field-error" role="alert">
                {t('quotationCenter.freightRatesRequired')}
              </p>
            ) : null}
            <div className="row-between">
              <h3>{t('quotationCenter.otherFees')}</h3>
              <Button
                variant="secondary"
                disabled={config.feeTypes.length === 0}
                onClick={() => {
                  const firstFeeType = config.feeTypes[0];
                  if (!firstFeeType) return;
                  setFees((current) => [
                    ...current,
                    {
                      feeTypeCode: firstFeeType.code,
                      name: firstFeeType.label,
                      amountCny: '0',
                    },
                  ]);
                  setResult(null);
                }}
              >
                {t('quotationCenter.addFee')}
              </Button>
            </div>
            {config.feeTypes.length === 0 ? (
              <p className="field-hint" role="status">
                {t('quotationCenter.feeTypesUnavailable')}
              </p>
            ) : null}
            {fees.map((fee, index) => (
              <div className="form-grid" key={`fee-${index}`}>
                <SimpleField label={t('quotationCenter.feeType')}>
                  <Select
                    value={fee.feeTypeCode}
                    disabled={config.feeTypes.length === 0}
                    onChange={(event) => {
                      setFees((current) =>
                        current.map((row, rowIndex) => {
                          const option = config.feeTypes.find(
                            (candidate) => candidate.code === event.target.value,
                          );
                          return rowIndex === index
                            ? {
                                ...row,
                                feeTypeCode: event.target.value,
                                name: option?.label ?? row.name,
                              }
                            : row;
                        }),
                      );
                      setResult(null);
                    }}
                    options={config.feeTypes.map((option) => ({
                      value: option.code,
                      label: option.label,
                    }))}
                  />
                </SimpleField>
                <SimpleField label={t('quotationCenter.feeName')}>
                  <Input
                    value={fee.name}
                    onChange={(event) => {
                      setFees((current) =>
                        current.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, name: event.target.value } : row,
                        ),
                      );
                      setResult(null);
                    }}
                    maxLength={160}
                  />
                </SimpleField>
                <SimpleField label={t('quotationCenter.feeAmount')}>
                  <Input
                    inputMode="decimal"
                    value={fee.amountCny}
                    onChange={(event) => {
                      setFees((current) =>
                        current.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, amountCny: event.target.value } : row,
                        ),
                      );
                      setResult(null);
                    }}
                  />
                </SimpleField>
                <Button
                  variant="danger"
                  onClick={() => {
                    setFees((current) => current.filter((_, rowIndex) => rowIndex !== index));
                    setResult(null);
                  }}
                >
                  {t('quotationCenter.removeFee')}
                </Button>
              </div>
            ))}
          </section>

          <section className="panel stack-sm">
            <div className="button-row">
              {canCalculate ? (
                <Button
                  variant="secondary"
                  loading={saving}
                  disabled={saving || items.length === 0}
                  onClick={() => void runPreview()}
                >
                  {t('quotationCenter.calculate')}
                </Button>
              ) : null}
              {canSave ? (
                <Button
                  variant="secondary"
                  loading={saving}
                  disabled={saving || !title.trim() || items.every((item) => !item.productId)}
                  onClick={() => void saveDraft()}
                >
                  {t('quotationCenter.saveDraft')}
                </Button>
              ) : null}
              {canCreateOrder ? (
                <Button
                  loading={saving}
                  disabled={saving || !title.trim() || items.length === 0}
                  onClick={() => void createOrder()}
                >
                  {t('quotationCenter.createOrder')}
                </Button>
              ) : null}
            </div>
            {result ? (
              <div className="stack-sm" aria-live="polite">
                <h2>{t('quotationCenter.summary')}</h2>
                <p>
                  {t('quotationCenter.weightSummary', {
                    volume: formatCalculatedValue(result.totals.volumeWeightKg),
                    gross: formatCalculatedValue(result.totals.grossWeightKg),
                    chargeable: formatCalculatedValue(result.totals.chargeableWeightKg),
                  })}
                </p>
                <p>
                  {t('quotationCenter.freightQuoteSummary', {
                    cbm: formatCalculatedValue(result.freight.cbmFreightAmount),
                    cbmTotal: formatCalculatedValue(result.freight.orderTotalCbm),
                    kg: formatCalculatedValue(result.freight.kgFreightAmount),
                    currency: result.freight.freightCurrencyCode,
                    basis: t(
                      result.freight.kgChargeableBasis === 'VOLUME_WEIGHT'
                        ? 'quotationCenter.volumeWeightBasis'
                        : 'quotationCenter.grossWeightBasis',
                    ),
                  })}
                </p>
                <p>
                  {t('quotationCenter.selectedFreightSummary', {
                    method: t(
                      result.freight.freightBillingMethod === 'CBM'
                        ? 'quotationCenter.billingByCbm'
                        : 'quotationCenter.billingByKg',
                    ),
                    amount: formatCalculatedValue(result.freight.selectedFreightAmount),
                    currency: result.freight.freightCurrencyCode,
                  })}
                </p>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('quotationCenter.product')}</th>
                        <th>{t('quotationCenter.quantity')}</th>
                        <th>{t('quotationCenter.unitPriceCny')}</th>
                        <th>{t('quotationCenter.amountCny')}</th>
                        {canReadFreightAllocation ? (
                          <th>{t('quotationCenter.freightAllocated')}</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((item) => (
                        <tr key={item.lineNo}>
                          <td>
                            {item.sku} · {item.productName}
                          </td>
                          <td>{formatCalculatedValue(item.quantity)}</td>
                          <td>{formatCalculatedValue(item.unitSalePriceCny)}</td>
                          <td>{formatCalculatedValue(item.lineAmountCny)}</td>
                          {canReadFreightAllocation ? (
                            <td>
                              {item.allocatedFreightCny
                                ? formatCalculatedValue(item.allocatedFreightCny)
                                : '—'}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  {t('quotationCenter.totalSummary', {
                    cny: formatCalculatedValue(result.totals.totalAmountCny),
                    currency: currencyCode,
                    foreign: formatCalculatedValue(result.totals.totalAmountForeign),
                  })}
                </p>
              </div>
            ) : null}
          </section>
        </>
      )}
      {productPickerOpen ? (
        <QuotationProductPickerDialog
          alreadyAddedIds={new Set(items.map((item) => item.productId))}
          onClose={() => setProductPickerOpen(false)}
          onAdd={addProducts}
        />
      ) : null}
    </div>
  );
}
