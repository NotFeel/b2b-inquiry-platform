'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Button, Input, PageHeader, Select, useToast } from '@b2b/ui';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { QuotationProductPickerDialog } from '../../../../components/quotation-product-picker-dialog';
import { CountrySelect, CurrencySelect } from '../../../../components/reference-selects';
import { useSession } from '../../../../components/session-provider';
import { AdminApiError } from '../../../../lib/admin-api';
import { translateError } from '../../../../lib/i18n';
import {
  quotationOrderApi,
  type CalculatorInput,
  type CalculatorExcelTemplateOption,
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
  markupPercent: string;
  cartonCount: string;
  cartonLengthCm: string;
  cartonWidthCm: string;
  cartonHeightCm: string;
  cartonGrossWeightKg: string;
};
type FeeDraft = { feeTypeCode: string; name: string; amountCny: string };
const blankItem = (): ItemDraft => ({
  productId: '',
  markupPercent: '20',
  cartonCount: '',
  cartonLengthCm: '',
  cartonWidthCm: '',
  cartonHeightCm: '',
  cartonGrossWeightKg: '',
});

function isValidFreightRate(value: string): boolean {
  const normalized = value.trim();
  return /^\d{1,16}(?:\.\d{1,8})?$/.test(normalized) && /[1-9]/.test(normalized);
}

function isValidExchangeRate(value: string): boolean {
  const normalized = value.trim();
  return /^\d{1,16}(?:\.\d{1,12})?$/.test(normalized) && /[1-9]/.test(normalized);
}

/** Strip insignificant fractional zeros for display without rounding the value. */
function formatCalculatedValue(value: string): string {
  if (!/^-?\d+\.\d+$/.test(value)) return value;
  const trimmed = value.replace(/0+$/, '');
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

/** Show CBM at up to eight fractional places, rounding half up and omitting trailing zeros. */
function formatCbmValue(value: string): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  if (fraction.length <= 8) return formatCalculatedValue(value);

  const scale = 100_000_000n;
  const scaled = BigInt(`${whole}${fraction.slice(0, 8)}`);
  const rounded = scaled + (fraction[8]! >= '5' ? 1n : 0n);
  const roundedValue = `${rounded / scale}.${(rounded % scale).toString().padStart(8, '0')}`;
  return formatCalculatedValue(`${negative ? '-' : ''}${roundedValue}`);
}

/** Display sale prices as a two-decimal ceiling without binary floating-point math. */
function formatSaleUnitPrice(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return value;
  const [whole = '0', fraction = ''] = value.split('.');
  const cents = BigInt(`${whole}${fraction.slice(0, 2).padEnd(2, '0')}`);
  const roundedCents = cents + (/[1-9]/.test(fraction.slice(2)) ? 1n : 0n);
  return `${roundedCents / 100n}.${(roundedCents % 100n).toString().padStart(2, '0')}`;
}

export default function QuotationCalculatorPage() {
  const { t, locale, can } = useSession();
  const breadcrumb = useBreadcrumb();
  const toast = useToast();
  const [config, setConfig] = useState<QuotationConfig | null>(null);
  const [chosenProducts, setChosenProducts] = useState<Record<string, CalculatorProduct>>({});
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [customers, setCustomers] = useState<
    {
      id: string;
      phoneE164: string;
      displayName: string | null;
      legalName: string | null;
      contactName: string | null;
      email: string | null;
      taxId: string | null;
      customerType: string;
      preferredLanguage: string;
      countryCode: string | null;
      billingAddress: Record<string, unknown> | null;
      defaultShippingAddress: Record<string, unknown> | null;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [previewSignature, setPreviewSignature] = useState('');
  const [excelTemplates, setExcelTemplates] = useState<CalculatorExcelTemplateOption[]>([]);
  const [excelTemplateId, setExcelTemplateId] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);
  const [title, setTitle] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState('');
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
  const [countryCode, setCountryCode] = useState('');
  const [shippingCountryCode, setShippingCountryCode] = useState('');
  const [customerType, setCustomerType] = useState<'COMPANY' | 'INDIVIDUAL'>('COMPANY');
  const [legalCompanyName, setLegalCompanyName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('en-US');
  const [buyerReference, setBuyerReference] = useState('');
  const [billingSameAsShipping, setBillingSameAsShipping] = useState(true);
  const [billingAddressLine, setBillingAddressLine] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingRegion, setBillingRegion] = useState('');
  const [billingPostalCode, setBillingPostalCode] = useState('');
  const [billingCountryCode, setBillingCountryCode] = useState('');
  const [shippingCompany, setShippingCompany] = useState('');
  const [shippingPhone, setShippingPhone] = useState('');
  const [incotermCode, setIncotermCode] = useState('');
  const [namedPlace, setNamedPlace] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
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
      const [nextConfig, nextCustomers, nextExcelTemplates] = await Promise.all([
        quotationOrderApi.config(locale),
        can('customer.read') ? quotationOrderApi.customers() : Promise.resolve({ data: [] }),
        canCalculate ? quotationOrderApi.calculatorExcelTemplates() : Promise.resolve([]),
      ]);
      setConfig(nextConfig);
      setVolumetricDivisorItemId(
        (current) => current || nextConfig.volumetricDivisors[0]?.id || '',
      );
      setCustomers(nextCustomers.data);
      setExcelTemplates(nextExcelTemplates);
      setExcelTemplateId((current) =>
        nextExcelTemplates.some((template) => template.id === current)
          ? current
          : (nextExcelTemplates[0]?.id ?? ''),
      );
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
  }, [can, canCalculate, locale, t]);

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

  const buildInput = (calculationOnly = false): CalculatorInput => ({
    title: title.trim(),
    customerId: calculationOnly ? null : customerId || null,
    customer: calculationOnly
      ? { companyName: '', contactName: '', phoneE164: '' }
      : {
          companyName: companyName.trim(),
          legalCompanyName: legalCompanyName.trim(),
          contactName: contactName.trim(),
          phoneE164: phone.trim(),
          countryCode: countryCode || null,
          customerType,
          taxId: taxId.trim(),
          preferredLanguage,
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(recipient && city && addressLine && shippingCountryCode
            ? {
                shippingAddress: {
                  recipient: recipient.trim(),
                  companyName: shippingCompany.trim(),
                  phoneE164: shippingPhone.trim(),
                  countryCode: shippingCountryCode,
                  region: region.trim(),
                  city: city.trim(),
                  postalCode: postalCode.trim(),
                  line1: addressLine.trim(),
                  line2: '',
                },
              }
            : {}),
          ...(billingSameAsShipping
            ? recipient && city && addressLine && shippingCountryCode
              ? {
                  billingAddress: {
                    recipient: recipient.trim(),
                    companyName: legalCompanyName.trim() || companyName.trim(),
                    phoneE164: phone.trim(),
                    countryCode,
                    region: region.trim(),
                    city: city.trim(),
                    postalCode: postalCode.trim(),
                    line1: addressLine.trim(),
                    line2: '',
                  },
                }
              : {}
            : billingAddressLine && billingCity && billingCountryCode
              ? {
                  billingAddress: {
                    recipient: legalCompanyName.trim() || companyName.trim(),
                    companyName: legalCompanyName.trim() || companyName.trim(),
                    phoneE164: phone.trim(),
                    countryCode: billingCountryCode,
                    region: billingRegion.trim(),
                    city: billingCity.trim(),
                    postalCode: billingPostalCode.trim(),
                    line1: billingAddressLine.trim(),
                    line2: '',
                  },
                }
              : {}),
        },
    buyerReference: buyerReference.trim(),
    trade: {
      incotermCode: incotermCode || null,
      namedPlace: namedPlace.trim(),
      paymentTerms: paymentTerms.trim(),
    },
    orderDate: calculationOnly ? null : orderDate,
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
      markupPercent: item.markupPercent,
      cartonCount: item.cartonCount ? Number(item.cartonCount) : 0,
      cartonLengthCm: item.cartonLengthCm || null,
      cartonWidthCm: item.cartonWidthCm || null,
      cartonHeightCm: item.cartonHeightCm || null,
      cartonGrossWeightKg: item.cartonGrossWeightKg || null,
    })),
    fees: fees.map((fee) => ({ ...fee })),
  });

  const validateItemQuantities = (): boolean => {
    if (items.length === 0) {
      setError(t('quotationCenter.itemsRequired'));
      return false;
    }
    const invalidCarton = items.find((item) => {
      const count = Number(item.cartonCount);
      return (
        !/^\d+$/.test(item.cartonCount) ||
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > 100000
      );
    });
    if (invalidCarton) {
      const product = chosenProducts[invalidCarton.productId];
      setError(
        t('quotationCenter.cartonCountRequiredForSku', {
          sku: product?.sku ?? invalidCarton.productId,
        }),
      );
      return false;
    }
    const missingUnitsPerCarton = items.find((item) => {
      const quantity = chosenProducts[item.productId]?.packaging.unitsPerCarton;
      return quantity === null || quantity === undefined || quantity <= 0;
    });
    if (missingUnitsPerCarton) {
      const product = chosenProducts[missingUnitsPerCarton.productId];
      setError(
        t('quotationCenter.unitsPerCartonMissingForSku', {
          sku: product?.sku ?? missingUnitsPerCarton.productId,
        }),
      );
      return false;
    }
    return true;
  };

  const runPreview = async () => {
    if (!validateItemQuantities()) return;
    const input = buildInput(true);
    if (currencyCode !== 'CNY' && !isValidExchangeRate(exchangeRate)) {
      setError(t('quotationCenter.exchangeRateRequired'));
      document.querySelector<HTMLInputElement>('input[placeholder="0.000000"]')?.focus();
      return;
    }
    if (!isValidFreightRate(input.cbmRatePerCbm) || !isValidFreightRate(input.kgRatePerKg)) {
      setPreviewRatesInvalid(true);
      setResult(null);
      setError('');
      return;
    }
    setPreviewRatesInvalid(false);
    setSaving(true);
    setError('');
    setPreviewSignature('');
    try {
      setResult(await quotationOrderApi.preview(input));
      setPreviewSignature(JSON.stringify(input));
    } catch (cause) {
      setResult(null);
      setPreviewSignature('');
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
    if (!validateItemQuantities()) return;
    if (currencyCode !== 'CNY' && !isValidExchangeRate(exchangeRate)) {
      setError(t('quotationCenter.exchangeRateRequired'));
      document.querySelector<HTMLInputElement>('input[placeholder="0.000000"]')?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await quotationOrderApi.saveDraft(buildInput());
      toast.success(t('quotationCenter.draftSaved', { number: saved.quotationNo }));
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : cause instanceof Error
            ? cause.message
            : t('quotationCenter.saveError'),
      );
    } finally {
      setSaving(false);
    }
  };

  const orderFieldLabels: Record<string, string> = {
    title: t('quotationCenter.titleField'),
    customerName: t('quotationCenter.orderFieldCustomerName'),
    phone: t('quotationCenter.phone'),
    countryCode: t('quotationCenter.countryCode'),
    shippingCountryCode: t('quotationCenter.shippingCountryCode'),
    orderDate: t('quotationCenter.orderDate'),
    exchangeRate: t('quotationCenter.exchangeRate'),
    recipient: t('quotationCenter.recipient'),
    city: t('quotationCenter.city'),
    addressLine: t('quotationCenter.addressLine'),
  };

  const orderReadiness = (() => {
    const missing: string[] = [];
    if (!title.trim()) missing.push('title');
    if (!companyName.trim() && !contactName.trim()) missing.push('customerName');
    if (!/^[A-Z]{2}$/.test(countryCode.trim())) missing.push('countryCode');
    if (!/^[A-Z]{2}$/.test(shippingCountryCode.trim())) missing.push('shippingCountryCode');
    if (!orderDate) missing.push('orderDate');
    if (currencyCode !== 'CNY' && !isValidExchangeRate(exchangeRate)) {
      missing.push('exchangeRate');
    }
    if (!recipient.trim()) missing.push('recipient');
    if (!city.trim()) missing.push('city');
    if (!addressLine.trim()) missing.push('addressLine');
    return {
      missing,
      phoneInvalid: !/^\+[1-9]\d{1,14}$/.test(phone.trim()),
    };
  })();

  const focusOrderProblem = () => {
    const shippingFields = ['shippingCountryCode', 'recipient', 'city', 'addressLine'];
    const pricingFields = ['exchangeRate'];
    const sectionId = orderReadiness.missing.some((field) => pricingFields.includes(field))
      ? 'calculator-pricing'
      : orderReadiness.missing.some((field) => shippingFields.includes(field))
        ? 'calculator-shipping'
        : 'calculator-customer';
    const section = document.getElementById(sectionId);
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const phoneInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="+14155552671"]',
    );
    if (orderReadiness.phoneInvalid && phoneInput) {
      phoneInput.focus();
      return;
    }
    if (orderReadiness.missing.includes('exchangeRate')) {
      document.querySelector<HTMLInputElement>('input[placeholder="0.000000"]')?.focus();
      return;
    }
    section?.querySelector<HTMLInputElement>('input, select')?.focus();
  };

  const validateOrderCustomer = () => {
    if (orderReadiness.phoneInvalid) {
      setError(t('quotationCenter.orderPhoneInvalid'));
      focusOrderProblem();
      return false;
    }
    if (orderReadiness.missing.length) {
      setError(
        t('quotationCenter.orderFieldsRequired', {
          fields: orderReadiness.missing
            .map((field) => orderFieldLabels[field] ?? field)
            .join('、'),
        }),
      );
      focusOrderProblem();
      return false;
    }
    return true;
  };

  const createOrder = async () => {
    if (!validateItemQuantities()) return;
    if (!validateOrderCustomer()) return;
    setSaving(true);
    setError('');
    try {
      const saved = await quotationOrderApi.createOrder(buildInput());
      toast.success(
        t('quotationCenter.orderCreated', {
          number: saved.orderNo,
          contractNo: saved.contractNo,
        }),
      );
    } catch (cause) {
      if (cause instanceof AdminApiError) {
        const fields = cause.details?.fields;
        if (Array.isArray(fields) && fields.length) {
          const fieldNames = fields.filter((field): field is string => typeof field === 'string');
          setError(
            fieldNames.includes('phone')
              ? t('quotationCenter.orderPhoneInvalid')
              : t('quotationCenter.orderFieldsRequired', {
                  fields: fieldNames.map((field) => orderFieldLabels[field] ?? field).join('、'),
                }),
          );
        } else setError(translateError(locale, cause.code));
      } else setError(cause instanceof Error ? cause.message : t('quotationCenter.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const currentInputSignature = JSON.stringify(buildInput(true));
  const previewMatchesCurrentInput = Boolean(
    result && previewSignature && previewSignature === currentInputSignature,
  );

  const exportCurrentExcel = async () => {
    if (!excelTemplateId || !previewMatchesCurrentInput) return;
    setExportingExcel(true);
    setError('');
    try {
      const file = await quotationOrderApi.exportCalculatorExcel(excelTemplateId, buildInput(true));
      quotationOrderApi.saveQuotationExcelDownload(file);
      toast.success(t('quotationCenter.excelExported'));
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : cause instanceof Error
            ? cause.message
            : t('quotationCenter.excelExportFailed'),
      );
    } finally {
      setExportingExcel(false);
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
      <nav className="calculator-section-nav" aria-label={t('quotationCenter.sectionNav')}>
        {[
          ['calculator-customer', 'customerSection'],
          ['calculator-trade', 'tradeTerms'],
          ['calculator-billing', 'billingAddress'],
          ['calculator-shipping', 'shippingAddress'],
          ['calculator-items', 'itemsSection'],
          ['calculator-pricing', 'pricingSection'],
          ['calculator-fees', 'otherFees'],
          ['calculator-result', 'summary'],
        ].map(([id, key]) => (
          <a key={id} href={`#${id}`}>
            {t(`quotationCenter.${key}`)}
          </a>
        ))}
      </nav>
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
          <section className="panel stack-sm" id="calculator-customer">
            <h2>{t('quotationCenter.customerSection')}</h2>
            <p className="muted">{t('quotationCenter.orderRequirementsHint')}</p>
            {customers.length ? (
              <SimpleField label={t('quotationCenter.existingCustomer')}>
                <Select
                  value={customerId}
                  onChange={(event) => {
                    const id = event.target.value;
                    setCustomerId(id);
                    const selected = customers.find((customer) => customer.id === id);
                    if (selected) {
                      const billing = selected.billingAddress;
                      const shipping = selected.defaultShippingAddress;
                      setCompanyName(selected.displayName ?? '');
                      setLegalCompanyName(selected.legalName ?? selected.displayName ?? '');
                      setContactName(selected.contactName ?? '');
                      setEmail(selected.email ?? '');
                      setTaxId(selected.taxId ?? '');
                      setCustomerType(
                        selected.customerType === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY',
                      );
                      setPreferredLanguage(
                        selected.preferredLanguage === 'zh-CN' ? 'zh-CN' : 'en-US',
                      );
                      setPhone(selected.phoneE164);
                      setCountryCode(selected.countryCode ?? countryCode);
                      if (billing) {
                        setBillingSameAsShipping(false);
                        setBillingAddressLine(String(billing.line1 ?? ''));
                        setBillingCity(String(billing.city ?? ''));
                        setBillingRegion(String(billing.region ?? billing.state ?? ''));
                        setBillingPostalCode(String(billing.postalCode ?? ''));
                        setBillingCountryCode(String(billing.countryCode ?? countryCode));
                      }
                      if (shipping) {
                        setRecipient(String(shipping.recipient ?? ''));
                        setShippingCountryCode(
                          String(shipping.countryCode ?? selected.countryCode ?? countryCode),
                        );
                        setShippingCompany(String(shipping.companyName ?? ''));
                        setShippingPhone(String(shipping.phoneE164 ?? ''));
                        setCity(String(shipping.city ?? ''));
                        setRegion(String(shipping.region ?? shipping.state ?? ''));
                        setPostalCode(String(shipping.postalCode ?? ''));
                        setAddressLine(String(shipping.line1 ?? ''));
                      }
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
                  placeholder={t('quotationCenter.phonePlaceholder')}
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
                <CountrySelect
                  value={countryCode}
                  onChange={setCountryCode}
                  placeholder={t('countrySelect.placeholder')}
                  ariaLabel={t('quotationCenter.countryCode')}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.orderDate')}>
                <Input
                  type="date"
                  lang={locale}
                  value={orderDate}
                  onChange={(event) => setOrderDate(event.target.value)}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.customerType')}>
                <Select
                  value={customerType}
                  onChange={(event) =>
                    setCustomerType(event.target.value as 'COMPANY' | 'INDIVIDUAL')
                  }
                  options={[
                    { value: 'COMPANY', label: t('quotationCenter.customerTypeCompany') },
                    { value: 'INDIVIDUAL', label: t('quotationCenter.customerTypeIndividual') },
                  ]}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.legalCompanyName')}>
                <Input
                  value={legalCompanyName}
                  onChange={(event) => setLegalCompanyName(event.target.value)}
                  maxLength={240}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.taxId')}>
                <Input
                  value={taxId}
                  onChange={(event) => setTaxId(event.target.value)}
                  maxLength={60}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.preferredLanguage')}>
                <Select
                  value={preferredLanguage}
                  onChange={(event) => setPreferredLanguage(event.target.value)}
                  options={[
                    { value: 'en-US', label: 'English (en-US)' },
                    { value: 'zh-CN', label: '中文 (zh-CN)' },
                  ]}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.buyerReference')}>
                <Input
                  value={buyerReference}
                  onChange={(event) => setBuyerReference(event.target.value)}
                  maxLength={120}
                />
              </SimpleField>
              <div className="field">
                <span className="field-label">{t('quotationCenter.contractNo')}</span>
                <p className="muted">{t('quotationCenter.contractNoAuto')}</p>
              </div>
            </div>
          </section>

          <section className="panel stack-sm" id="calculator-trade">
            <h2>{t('quotationCenter.tradeTerms')}</h2>
            <div className="form-grid">
              <SimpleField label={t('quotationCenter.incoterm')}>
                <Select
                  value={incotermCode}
                  onChange={(event) => setIncotermCode(event.target.value)}
                  placeholder={t('common.none')}
                  options={[
                    'EXW',
                    'FCA',
                    'FAS',
                    'FOB',
                    'CFR',
                    'CIF',
                    'CPT',
                    'CIP',
                    'DAP',
                    'DPU',
                    'DDP',
                  ].map((code) => ({ value: code, label: code }))}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.namedPlace')}>
                <Input
                  value={namedPlace}
                  onChange={(event) => setNamedPlace(event.target.value)}
                  maxLength={240}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.paymentTerms')}>
                <Input
                  value={paymentTerms}
                  onChange={(event) => setPaymentTerms(event.target.value)}
                  maxLength={500}
                />
              </SimpleField>
            </div>
          </section>

          <section className="panel stack-sm" id="calculator-billing">
            <h2>{t('quotationCenter.billingAddress')}</h2>
            <label className="field-checkbox">
              <input
                type="checkbox"
                checked={billingSameAsShipping}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setBillingSameAsShipping(checked);
                  if (!checked) return;
                  setBillingAddressLine(addressLine);
                  setBillingCity(city);
                  setBillingRegion(region);
                  setBillingPostalCode(postalCode);
                  setBillingCountryCode(shippingCountryCode);
                }}
              />
              <span>{t('quotationCenter.billingSameAsShipping')}</span>
            </label>
            <p className="field-help">{t('quotationCenter.billingSameAsShippingHint')}</p>
            {billingSameAsShipping ? null : (
              <div className="form-grid">
                <SimpleField label={t('quotationCenter.addressLine')}>
                  <Input
                    value={billingAddressLine}
                    onChange={(event) => setBillingAddressLine(event.target.value)}
                    maxLength={240}
                  />
                </SimpleField>
                <SimpleField label={t('quotationCenter.city')}>
                  <Input
                    value={billingCity}
                    onChange={(event) => setBillingCity(event.target.value)}
                    maxLength={120}
                  />
                </SimpleField>
                <SimpleField label={t('quotationCenter.region')}>
                  <Input
                    value={billingRegion}
                    onChange={(event) => setBillingRegion(event.target.value)}
                    maxLength={120}
                  />
                </SimpleField>
                <SimpleField label={t('quotationCenter.postalCode')}>
                  <Input
                    value={billingPostalCode}
                    onChange={(event) => setBillingPostalCode(event.target.value)}
                    maxLength={40}
                  />
                </SimpleField>
                <SimpleField label={t('quotationCenter.billingCountryCode')}>
                  <CountrySelect
                    value={billingCountryCode}
                    onChange={setBillingCountryCode}
                    placeholder={t('countrySelect.placeholder')}
                    ariaLabel={t('quotationCenter.billingCountryCode')}
                  />
                </SimpleField>
              </div>
            )}
          </section>

          <section className="panel stack-sm" id="calculator-shipping">
            <h2>{t('quotationCenter.shippingAddress')}</h2>
            <div className="form-grid">
              <SimpleField label={t('quotationCenter.recipient')}>
                <Input
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  maxLength={160}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.shippingCompany')}>
                <Input
                  value={shippingCompany}
                  onChange={(event) => setShippingCompany(event.target.value)}
                  maxLength={240}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.shippingPhone')}>
                <Input
                  value={shippingPhone}
                  onChange={(event) => setShippingPhone(event.target.value)}
                  maxLength={24}
                />
              </SimpleField>
              <SimpleField label={t('quotationCenter.shippingCountryCode')}>
                <CountrySelect
                  value={shippingCountryCode}
                  onChange={setShippingCountryCode}
                  placeholder={t('countrySelect.placeholder')}
                  ariaLabel={t('quotationCenter.shippingCountryCode')}
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

          <section className="panel stack-sm" id="calculator-items">
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
                    <th scope="col">{t('quotationCenter.unitsPerCarton')}</th>
                    <th scope="col">{t('quotationCenter.markup')}</th>
                    <th scope="col">{t('quotationCenter.cartons')}</th>
                    <th scope="col">{t('quotationCenter.totalQuantity')}</th>
                    <th scope="col">{t('quotationCenter.dimensions')}</th>
                    <th scope="col">{t('quotationCenter.cartonWeight')}</th>
                    <th scope="col">
                      {t('quotationCenter.unitPrice', { currency: currencyCode })}
                    </th>
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
                      const unitsPerCarton =
                        calculatedItem?.unitsPerCarton ?? product?.packaging.unitsPerCarton;
                      const cartonCount = Number(item.cartonCount);
                      const totalQuantity =
                        (calculatedItem ? formatCalculatedValue(calculatedItem.quantity) : null) ??
                        (unitsPerCarton && Number.isSafeInteger(cartonCount) && cartonCount > 0
                          ? String(unitsPerCarton * cartonCount)
                          : '—');
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
                            <span
                              aria-label={t('quotationCenter.unitsPerCartonForSku', {
                                sku: product?.sku ?? '',
                              })}
                            >
                              {unitsPerCarton ?? '—'}
                            </span>
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
                              type="number"
                              min={1}
                              max={100000}
                              step={1}
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
                          <td>{totalQuantity}</td>
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
                              ? `${currencyCode} ${formatSaleUnitPrice(calculatedItem.unitSalePriceForeign)}`
                              : '—'}
                          </td>
                          <td>
                            {calculatedItem ? formatCbmValue(calculatedItem.cartonVolumeCbm) : '—'}
                          </td>
                          <td>{calculatedItem ? formatCbmValue(calculatedItem.totalCbm) : '—'}</td>
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

          <section className="panel stack-sm" id="calculator-pricing">
            <h2>{t('quotationCenter.pricingSection')}</h2>
            <div className="form-grid">
              <SimpleField label={t('quotationCenter.currency')}>
                <CurrencySelect
                  value={currencyCode}
                  onChange={(value) => {
                    setCurrencyCode(value);
                    setResult(null);
                  }}
                  options={config.currencies}
                  ariaLabel={t('quotationCenter.currency')}
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
                  placeholder="0.000000"
                />
                <p className="field-help">{t('quotationCenter.exchangeRateHint')}</p>
              </SimpleField>
              <SimpleField label={t('quotationCenter.exchangeRateDate')}>
                <Input
                  type="date"
                  lang={locale}
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
          </section>

          <section className="panel stack-sm" id="calculator-fees">
            <div className="row-between">
              <h2>{t('quotationCenter.otherFees')}</h2>
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

          <section className="panel stack-sm" id="calculator-result">
            {previewMatchesCurrentInput && result ? (
              <div className="stack-sm" aria-live="polite">
                <h2>{t('quotationCenter.summary')}</h2>
                {canCalculate && canReadFreightAllocation ? (
                  <div className="button-row">
                    <label className="field">
                      <span className="field-label">{t('quotationCenter.excelTemplate')}</span>
                      <Select
                        value={excelTemplateId}
                        disabled={exportingExcel || excelTemplates.length === 0}
                        options={excelTemplates.map((template) => ({
                          value: template.id,
                          label: `${template.name} v${template.version}`,
                        }))}
                        onChange={(event) => setExcelTemplateId(event.target.value)}
                      />
                    </label>
                    <Button
                      variant="secondary"
                      loading={exportingExcel}
                      disabled={exportingExcel || !excelTemplateId}
                      onClick={() => void exportCurrentExcel()}
                    >
                      {t('quotationCenter.exportExcel')}
                    </Button>
                    {excelTemplates.length === 0 ? (
                      <span className="muted">{t('quotationCenter.noExcelTemplate')}</span>
                    ) : null}
                  </div>
                ) : null}
                <p>
                  {t('quotationCenter.weightSummary', {
                    volume: formatCalculatedValue(result.totals.volumeWeightKg),
                    gross: formatCalculatedValue(result.totals.grossWeightKg),
                    chargeable: formatCalculatedValue(result.totals.chargeableWeightKg),
                  })}
                </p>
                <p>
                  {t('quotationCenter.freightQuoteSummary', {
                    cbm: formatCalculatedValue(result.freight.cbmFreightAmountForeign),
                    cbmTotal: formatCbmValue(result.freight.orderTotalCbm),
                    kg: formatCalculatedValue(result.freight.kgFreightAmountForeign),
                    currency: currencyCode,
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
                    amount: formatCalculatedValue(result.freight.selectedFreightAmountForeign),
                    currency: currencyCode,
                  })}
                </p>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('quotationCenter.product')}</th>
                        <th>{t('quotationCenter.totalQuantity')}</th>
                        <th>{t('quotationCenter.unitPrice', { currency: currencyCode })}</th>
                        <th>{t('quotationCenter.amount')}</th>
                        {canReadFreightAllocation ? (
                          <th>
                            {t('quotationCenter.freightAllocated', { currency: currencyCode })}
                          </th>
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
                          <td>{formatSaleUnitPrice(item.unitSalePriceForeign)}</td>
                          <td>{formatCalculatedValue(item.lineAmountForeign)}</td>
                          {canReadFreightAllocation ? (
                            <td>
                              {item.allocatedFreightForeign
                                ? formatCalculatedValue(item.allocatedFreightForeign)
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
                    currency: currencyCode,
                    amount: formatCalculatedValue(result.totals.totalAmountForeign),
                  })}
                </p>
              </div>
            ) : null}
          </section>

          <div
            className="calculator-action-bar"
            role="region"
            aria-label={t('quotationCenter.actions')}
          >
            <div className="calculator-action-status" aria-live="polite">
              {canCreateOrder ? (
                orderReadiness.missing.length === 0 && !orderReadiness.phoneInvalid ? (
                  <span className="calculator-ready">{t('quotationCenter.orderReady')}</span>
                ) : orderReadiness.phoneInvalid ? (
                  <span className="field-error">{t('quotationCenter.orderPhoneInvalid')}</span>
                ) : (
                  <span className="field-error">
                    {t('quotationCenter.orderNotReady', {
                      fields: orderReadiness.missing
                        .map((field) => orderFieldLabels[field] ?? field)
                        .join('、'),
                    })}
                  </span>
                )
              ) : null}
            </div>
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
          </div>
        </>
      )}
      {productPickerOpen ? (
        <QuotationProductPickerDialog
          alreadyAddedIds={new Set(items.map((item) => item.productId))}
          publishStatusOptions={config?.publishStatuses ?? []}
          lifecycleStatusOptions={config?.productLifecycles ?? []}
          onClose={() => setProductPickerOpen(false)}
          onAdd={addProducts}
        />
      ) : null}
    </div>
  );
}
