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
    taxId: '91310000TEST',
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
  declaration: {
    countryOfOrigin: 'CN',
    text: 'The goods are of Chinese origin.',
    authenticityText: 'The exporter confirms these details are authentic.',
  },
  signature: {
    sellerName: 'Alice Seller',
    sellerTitle: 'Export Manager',
  },
  notes: 'Inspection is welcome before shipment.',
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

  it('uses ruled item-table cells and right-aligns numeric headers with their data', () => {
    const config = createDefaultTemplateConfig('CI');
    const html = renderCommercialDocumentHtml(config, baseDocument);

    expect(html).toContain('table.items th, table.items td { border: 0.4pt solid #d1d5db;');
    expect(html).toContain('table.items th:not(.numeric) { text-align: left; }');
    expect(html).toContain('td.numeric, th.numeric { text-align: right; }');
    expect(html).toContain('<th class="numeric" style="width:11%">Unit price</th>');
    expect(html).toContain('<th class="numeric" style="width:12%">Amount</th>');
    expect(html).toContain('<td class="numeric">0.28</td>');
    expect(html).toContain('<td class="numeric">280.00</td>');
  });

  it('routes header metadata through the shared field visibility settings', () => {
    const config = createDefaultTemplateConfig('CI');
    for (const [section, field] of [
      ['invoice', 'document.number'],
      ['invoice', 'document.revision'],
      ['trade', 'trade.currency'],
    ] as const) {
      const configField = config.sections
        .find((candidate) => candidate.key === section)
        ?.fields.find((candidate) => candidate.key === field);
      if (configField) configField.visible = false;
    }
    const html = renderCommercialDocumentHtml(config, baseDocument);
    expect(html).not.toContain('CI-20261106-0001');
    expect(html).not.toContain('Revision');
    expect(html).not.toContain('>R1<');
    expect(html).not.toContain('Currency');
  });

  it('omits empty regions and every hidden special block', () => {
    const config = createDefaultTemplateConfig('CI');
    const buyer = config.sections.find((section) => section.key === 'buyer');
    buyer?.fields.forEach((field) => {
      field.visible = false;
    });
    const sellerTaxId = config.sections
      .find((section) => section.key === 'seller')
      ?.fields.find((field) => field.key === 'seller.taxId');
    if (sellerTaxId) sellerTaxId.visible = false;
    config.sections.find((section) => section.key === 'totals')!.visible = false;
    config.notes.visible = false;
    config.terms.showPaymentNotice = false;
    config.terms.showShipmentNotice = false;
    config.terms.showAuthenticityDeclaration = false;
    config.terms.paymentNotice = 'Payment notice must stay hidden';
    config.terms.shipmentNotice = 'Shipment notice must stay hidden';
    config.terms.authenticityDeclaration = 'Authenticity must stay hidden';
    config.sections
      .find((section) => section.key === 'declaration')
      ?.fields.forEach((field) => {
        field.visible = false;
      });

    const html = renderCommercialDocumentHtml(config, baseDocument);
    expect(html).not.toContain('91310000TEST');
    expect(html).not.toContain('bob@example.com');
    expect(html).not.toContain('Buyer email');
    expect(html).not.toContain('Inspection is welcome before shipment.');
    expect(html).not.toContain('Payment notice must stay hidden');
    expect(html).not.toContain('Shipment notice must stay hidden');
    expect(html).not.toContain('Authenticity must stay hidden');
    expect(html).not.toContain('class="block declaration"');
    expect(html).not.toContain('table class="totals"');
  });

  it('renders signature cells independently and shows the stamp independently of the logo', () => {
    const config = createDefaultTemplateConfig('CI');
    const signature = config.sections.find((section) => section.key === 'signature')!;
    signature.fields.forEach((field) => {
      if (field.key === 'signature.seller') field.visible = true;
      if (field.key === 'signature.buyer') field.visible = false;
    });
    config.header.showLogo = false;
    config.header.showStamp = true;
    const html = renderCommercialDocumentHtml(config, baseDocument, {
      logoDataUri: 'data:image/png;base64,LOGO',
      stampDataUri: 'data:image/png;base64,STAMP',
    });
    expect(html).not.toContain('LOGO');
    const overlay = html.match(
      /<img class="stamp-overlay" src="data:image\/svg\+xml;base64,([^"]+)"/,
    )?.[1];
    expect(overlay).toBeDefined();
    const svg = Buffer.from(overlay!, 'base64').toString('utf8');
    expect(svg).toContain('data:image/png;base64,STAMP');
    expect(svg).toContain('Seller signature / stamp');
    expect(svg).not.toContain('Buyer signature');
  });

  it('composes the seller stamp above the signature text inside its signature cell', () => {
    const config = createDefaultTemplateConfig('CI');
    const html = renderCommercialDocumentHtml(config, baseDocument, {
      stampDataUri: 'data:image/png;base64,STAMP',
    });

    expect(html).toContain('<div class="signature-cell has-stamp">');
    expect(html).toContain(
      '.stamp-overlay { display: block; width: 80mm; max-width: 100%; height: 34mm; }',
    );

    const overlay = html.match(
      /<img class="stamp-overlay" src="data:image\/svg\+xml;base64,([^"]+)"/,
    )?.[1];
    expect(overlay).toBeDefined();
    const svg = Buffer.from(overlay!, 'base64').toString('utf8');
    expect(svg).toContain('>Seller signature / stamp</text>');
    expect(svg).toContain('>Alice Seller, Export Manager</text>');
    expect(svg).toContain('<image href="data:image/png;base64,STAMP"');
    expect(svg.indexOf('<image')).toBeGreaterThan(
      svg.indexOf('>Alice Seller, Export Manager</text>'),
    );
  });

  it('does not output a signature or item table without visible cells', () => {
    const config = createDefaultTemplateConfig('CI');
    const signature = config.sections.find((section) => section.key === 'signature')!;
    signature.fields.forEach((field) => {
      field.visible = false;
    });
    config.itemColumns.forEach((column) => {
      column.visible = false;
    });
    const html = renderCommercialDocumentHtml(config, baseDocument);
    expect(html).not.toContain('<section class="signature">');
    expect(html).not.toContain('<table class="items">');
  });
});

describe('findMissingDocumentFields', () => {
  it('accepts a complete CI', () => {
    const report = findMissingDocumentFields(baseDocument, createDefaultTemplateConfig('CI'));
    expect(report.missing).toEqual([]);
    expect(report.missingItemLines).toEqual([]);
    expect(report.businessRequired).toEqual([]);
    expect(report.templateRequired).toEqual([]);
    expect(report.templateVisibilityConflicts).toEqual([]);
  });

  it('reports customs, trade and bank gaps specifically', () => {
    const config = createDefaultTemplateConfig('CI');
    for (const key of ['trade.namedPlace', 'trade.paymentTerms']) {
      const field = config.sections
        .flatMap((section) => section.fields)
        .find((candidate) => candidate.key === key);
      if (field) field.required = true;
    }
    for (const key of ['payment.bankName', 'payment.accountNumber']) {
      const field = config.sections
        .flatMap((section) => section.fields)
        .find((candidate) => candidate.key === key);
      if (field) field.required = true;
    }
    for (const key of ['items.hsCode', 'items.originCountryCode']) {
      const column = config.itemColumns.find((candidate) => candidate.key === key);
      if (column) column.required = true;
    }
    const incomplete: CommercialDocumentRenderData = {
      ...baseDocument,
      trade: { incotermCode: 'DDP' },
      payment: { accountHolder: 'Wuxan' },
      items: [{ ...baseDocument.items[0]!, hsCode: '', originCountryCode: '' }],
    };
    const report = findMissingDocumentFields(incomplete, config);
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
    expect(report.businessRequired.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['trade.namedPlace', 'trade.paymentTerms', 'payment.bankName']),
    );
    expect(report.itemLineMissing[0]?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'items.hsCode',
          source: 'TEMPLATE_REQUIRED',
          lineNo: 1,
        }),
        expect.objectContaining({
          key: 'items.originCountryCode',
          source: 'TEMPLATE_REQUIRED',
        }),
      ]),
    );
  });

  it('does not enforce a business field when the template does not require it', () => {
    const config = createDefaultTemplateConfig('CI');
    const document: CommercialDocumentRenderData = {
      ...baseDocument,
      buyer: {
        ...baseDocument.buyer,
        companyName: null,
        billingAddress: null,
      },
    };
    const report = findMissingDocumentFields(document, config);
    expect(report.missing).not.toContain('buyer.companyName');
    expect(report.businessRequired).toEqual([]);
    expect(report.templateRequired).toEqual([]);
  });

  it('does not validate required fields when their template section or column is hidden', () => {
    const config = createDefaultTemplateConfig('CI');
    const buyer = config.sections.find((section) => section.key === 'buyer');
    if (buyer) buyer.visible = false;
    for (const field of buyer?.fields ?? []) field.required = true;
    const hsColumn = config.itemColumns.find((column) => column.key === 'items.hsCode');
    if (hsColumn) {
      hsColumn.visible = false;
      hsColumn.required = true;
    }
    const report = findMissingDocumentFields(
      { ...baseDocument, buyer: { ...baseDocument.buyer, phone: null } },
      config,
    );
    expect(report.missing).not.toContain('buyer.companyName');
    expect(report.missing).not.toContain('buyer.phone');
    expect(report.missingItemLines.flatMap((line) => line.fields)).not.toContain('items.hsCode');
    expect(report.templateVisibilityConflicts).toEqual([]);
    expect(report.templateRequired.map((entry) => entry.key)).not.toContain('buyer.phone');
  });

  it('reports visible required template fields as an additional source', () => {
    const config = createDefaultTemplateConfig('CI');
    const sellerTaxId = config.sections
      .find((section) => section.key === 'seller')
      ?.fields.find((field) => field.key === 'seller.taxId');
    if (sellerTaxId) sellerTaxId.required = true;
    const report = findMissingDocumentFields(
      { ...baseDocument, seller: { ...baseDocument.seller, taxId: null } },
      config,
    );
    expect(report.templateRequired).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'seller.taxId',
          source: 'TEMPLATE_REQUIRED',
          sectionKey: 'seller',
        }),
      ]),
    );
    expect(report.businessRequired.map((entry) => entry.key)).not.toContain('seller.taxId');
  });
});

describe('parseTemplateConfig', () => {
  it('defaults item-column required to false for historical templates', () => {
    const config = createDefaultTemplateConfig('CI') as unknown as {
      itemColumns: Array<Record<string, unknown>>;
    };
    const legacy = {
      ...config,
      itemColumns: config.itemColumns.map(({ required: _required, ...column }) => column),
    };

    expect(
      parseTemplateConfig(legacy).itemColumns.every((column) => column.required === false),
    ).toBe(true);
  });

  it('rejects unknown field keys, script-like values and duplicate columns', () => {
    const config = createDefaultTemplateConfig('CI') as unknown as Record<string, unknown>;
    expect(() =>
      parseTemplateConfig({
        ...config,
        sections: [
          { key: 'seller', visible: true, fields: [{ key: 'evil<script>', visible: true }] },
        ],
      }),
    ).toThrow();
    const duplicate = createDefaultTemplateConfig('CI');
    duplicate.itemColumns.push({ ...duplicate.itemColumns[0]! });
    expect(() => parseTemplateConfig(duplicate)).toThrow();
  });

  it('normalizes legacy configurations without changing their expected rendering', () => {
    const legacy = createDefaultTemplateConfig('CI') as unknown as Record<string, unknown>;
    const header = legacy.header as Record<string, unknown>;
    const footer = legacy.footer as Record<string, unknown>;
    const terms = legacy.terms as Record<string, unknown>;
    delete header.showStamp;
    delete footer.showText;
    delete terms.showPaymentNotice;
    delete terms.showShipmentNotice;
    delete terms.showAuthenticityDeclaration;
    delete legacy.notes;

    const parsed = parseTemplateConfig(legacy);
    expect(parsed.header.showStamp).toBe(parsed.header.showLogo);
    expect(parsed.notes.visible).toBe(true);
    expect(parsed.terms.showPaymentNotice).toBe(true);
    expect(parsed.terms.showShipmentNotice).toBe(true);
    expect(parsed.terms.showAuthenticityDeclaration).toBe(true);
  });
});
