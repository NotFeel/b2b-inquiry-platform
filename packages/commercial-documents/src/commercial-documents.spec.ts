import { describe, expect, it } from 'vitest';
import { amountInWords } from './amount-in-words';
import { calculateDocumentTotals, DocumentCalculationError } from './totals';
import { renderCommercialDocumentHtml } from './render';
import { findMissingDocumentFields } from './missing-fields';
import { createDefaultTemplateConfig, parseTemplateConfig } from './template-config';
import type { CommercialDocumentRenderData } from './render';

const baseDocument: CommercialDocumentRenderData = {
  documentType: 'CI',
  documentNo: 'CI-20261106-0001',
  revisionNo: 1,
  status: 'DRAFT',
  locale: 'en-US',
  currency: 'USD',
  issueDate: '2026-11-06',
  orderNo: 'O-20261106-0001',
  orderDate: '2026-11-05',
  seller: {
    companyName: 'Wuxan Global <Trading>',
    contactName: 'Alice',
    phone: '+8613800000000',
    email: 'sales@example.com',
    address: {
      line1: '88 Industrial Road',
      city: 'Shanghai',
      postalCode: '200000',
      countryCode: 'CN',
    },
  },
  buyer: {
    companyName: 'ACME & Sons',
    contactName: 'Bob',
    phone: '+14155550100',
    email: 'bob@example.com',
    billingAddress: {
      line1: '1 Main Street',
      city: 'Snellville',
      state: 'GA',
      postalCode: '30078',
      countryCode: 'US',
    },
  },
  consignee: {
    companyName: 'ACME warehouse',
    contactName: 'Bob',
    shippingAddress: {
      line1: '2 Warehouse Way',
      city: 'Atlanta',
      state: 'GA',
      postalCode: '30301',
      countryCode: 'US',
    },
  },
  trade: {
    incotermCode: 'DDP',
    namedPlace: 'Atlanta, GA',
    paymentTerms: 'T/T 30% deposit',
  },
  shipping: {
    method: 'Sea freight',
    cartonCount: 20,
    grossWeightKg: '320.5',
    cbm: '4.2',
  },
  payment: {
    accountHolder: 'Wuxan Global Trading',
    bankName: 'Bank of China',
    accountNumber: '1234567890',
    swiftCode: 'BKCHCNBJ',
  },
  items: [
    {
      lineNo: 1,
      sku: 'SKU-1',
      description: 'Steel bolt <M12>',
      hsCode: '73181590',
      originCountryCode: 'CN',
      quantity: '1000',
      unit: 'pcs',
      unitPrice: '0.28',
      lineAmount: '280.00',
    },
  ],
  totals: {
    subtotal: '280.00',
    discountAmount: '0',
    freightAmount: '100.00',
    insuranceAmount: '0',
    otherCharges: '20.00',
    totalAmount: '400.00',
  },
};

describe('calculateDocumentTotals', () => {
  it('recomputes lines and totals with Decimal and adds each charge once', () => {
    const result = calculateDocumentTotals({
      currency: 'USD',
      items: [
        { quantity: '1000', unitPrice: '0.28' },
        { quantity: '2', unitPrice: '15.555', discountAmount: '1.00' },
      ],
      discountAmount: '10',
      freightAmount: '100',
      insuranceAmount: '5',
      otherCharges: '20',
    });
    expect(result.items[0]?.lineAmount).toBe('280.00');
    expect(result.items[1]?.lineAmount).toBe('30.11');
    expect(result.subtotal).toBe('310.11');
    expect(result.totalAmount).toBe('425.11');
  });

  it('rejects negative values, zero quantity and line discounts above the gross', () => {
    expect(() =>
      calculateDocumentTotals({ currency: 'USD', items: [{ quantity: '0', unitPrice: '1' }] }),
    ).toThrow(DocumentCalculationError);
    expect(() =>
      calculateDocumentTotals({ currency: 'USD', items: [{ quantity: '1', unitPrice: '-1' }] }),
    ).toThrow(DocumentCalculationError);
    expect(() =>
      calculateDocumentTotals({
        currency: 'USD',
        items: [{ quantity: '1', unitPrice: '1', discountAmount: '2' }],
      }),
    ).toThrow(DocumentCalculationError);
  });

  it('enforces a single document currency', () => {
    expect(() =>
      calculateDocumentTotals({
        currency: 'USD',
        items: [{ quantity: '1', unitPrice: '1', currency: 'EUR' }],
      }),
    ).toThrow(/currency/i);
  });
});

describe('amountInWords', () => {
  it('renders English currency amounts with minor units', () => {
    expect(amountInWords('1234.56', 'USD')).toBe(
      'US Dollars One Thousand Two Hundred Thirty Four and Fifty Six Cents Only',
    );
    expect(amountInWords('400.00', 'USD')).toBe('US Dollars Four Hundred Only');
  });

  it('renders Chinese uppercase amounts', () => {
    expect(amountInWords('1234.56', 'USD', 'zh-CN')).toBe('美元壹仟贰佰叁拾肆元伍角陆分');
  });

  it('falls back to the numeric amount for unknown currencies', () => {
    expect(amountInWords('10.00', 'XYZ')).toBe('XYZ 10.00');
  });
});

describe('renderCommercialDocumentHtml', () => {
  it('escapes business values and never emits an internal cost', () => {
    const config = createDefaultTemplateConfig('CI');
    const html = renderCommercialDocumentHtml(config, baseDocument);
    expect(html).toContain('ACME &amp; Sons');
    expect(html).toContain('Steel bolt &lt;M12&gt;');
    expect(html).not.toContain('costCny');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
  });

  it('omits hidden fields and hidden item columns', () => {
    const config = createDefaultTemplateConfig('CI');
    const hsSection = config.sections.find((section) => section.key === 'trade');
    hsSection?.fields.forEach((field) => {
      if (field.key === 'trade.paymentTerms') field.visible = false;
    });
    config.itemColumns.forEach((column) => {
      if (column.key === 'items.hsCode') column.visible = false;
    });
    const html = renderCommercialDocumentHtml(config, baseDocument);
    expect(html).not.toContain('T/T 30% deposit');
    expect(html).not.toContain('73181590');
  });
});

describe('findMissingDocumentFields', () => {
  it('accepts a complete CI', () => {
    const report = findMissingDocumentFields(baseDocument, createDefaultTemplateConfig('CI'));
    expect(report.missing).toEqual([]);
    expect(report.missingItemLines).toEqual([]);
  });

  it('reports customs, trade and bank gaps specifically', () => {
    const incomplete: CommercialDocumentRenderData = {
      ...baseDocument,
      trade: { incotermCode: 'DDP' },
      payment: { accountHolder: 'Wuxan' },
      items: [{ ...baseDocument.items[0]!, hsCode: '', originCountryCode: '' }],
    };
    const report = findMissingDocumentFields(incomplete, createDefaultTemplateConfig('CI'));
    expect(report.missing).toEqual(
      expect.arrayContaining([
        'trade.namedPlace',
        'trade.paymentTerms',
        'payment.bankName',
        'payment.accountNumber',
      ]),
    );
    expect(report.missingItemLines[0]?.fields).toEqual(
      expect.arrayContaining(['items.hsCode', 'items.originCountryCode']),
    );
  });
});

describe('parseTemplateConfig', () => {
  it('rejects unknown field keys, script-like values and duplicate columns', () => {
    const config = createDefaultTemplateConfig('CI') as unknown as Record<string, unknown>;
    expect(() =>
      parseTemplateConfig({
        ...config,
        sections: [{ key: 'seller', visible: true, fields: [{ key: 'evil<script>', visible: true }] }],
      }),
    ).toThrow();
    const duplicate = createDefaultTemplateConfig('CI');
    duplicate.itemColumns.push({ ...duplicate.itemColumns[0]! });
    expect(() => parseTemplateConfig(duplicate)).toThrow();
  });
});
