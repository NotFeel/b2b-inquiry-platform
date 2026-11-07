import { describe, expect, it } from 'vitest';
import {
  createCommercialDocumentSchema,
  updateCommercialDocumentSchema,
  updateOrderCustomerSnapshotSchema,
} from './commercial-documents';
import {
  createDefaultTemplateConfig,
  documentTemplateConfigSchema,
} from '@b2b/commercial-documents';

const address = {
  line1: '1 Main Street',
  city: 'Atlanta',
  state: 'GA',
  postalCode: '30301',
  countryCode: 'US',
};

const buyer = {
  companyName: 'ACME LLC',
  contactName: 'Bob',
  phone: '+14155550100',
  countryCode: 'US',
  billingAddress: address,
};

const consignee = {
  companyName: 'ACME warehouse',
  contactName: 'Bob',
  shippingAddress: address,
};

describe('updateOrderCustomerSnapshotSchema', () => {
  it('accepts a complete buyer and consignee correction', () => {
    const parsed = updateOrderCustomerSnapshotSchema.parse({
      version: 3,
      buyer,
      consignee,
      buyerReference: 'PO-1',
      contractNo: 'CT-1',
      trade: { incotermCode: 'DDP', namedPlace: 'Atlanta', paymentTerms: 'T/T' },
    });
    expect(parsed.buyer.billingAddress?.countryCode).toBe('US');
    expect(parsed.trade?.incotermCode).toBe('DDP');
  });

  it('rejects a missing phone and incomplete billing address', () => {
    const result = updateOrderCustomerSnapshotSchema.safeParse({
      version: 1,
      buyer: { companyName: 'ACME', billingAddress: { line1: '1 Main' } },
      consignee,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((issue) => issue.path.join('.'));
      expect(fields).toEqual(expect.arrayContaining(['buyer.phone', 'buyer.billingAddress']));
    }
  });
});

describe('createCommercialDocumentSchema', () => {
  it('allows only PI/CI and normalises currency', () => {
    const parsed = createCommercialDocumentSchema.parse({
      documentType: 'CI',
      locale: 'en-US',
      currency: 'usd',
    });
    expect(parsed.currency).toBe('USD');
    expect(
      createCommercialDocumentSchema.safeParse({ documentType: 'INVOICE' }).success,
    ).toBe(false);
  });
});

describe('updateCommercialDocumentSchema', () => {
  it('requires a positive version for optimistic locking', () => {
    expect(updateCommercialDocumentSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(
      updateCommercialDocumentSchema.safeParse({
        version: 2,
        items: [{ quantity: '1', unitPrice: '2.5', hsCode: '73181590' }],
      }).success,
    ).toBe(true);
  });
});

describe('documentTemplateConfigSchema', () => {
  it('accepts the built-in default templates', () => {
    expect(documentTemplateConfigSchema.safeParse(createDefaultTemplateConfig('PI')).success).toBe(
      true,
    );
    expect(documentTemplateConfigSchema.safeParse(createDefaultTemplateConfig('CI')).success).toBe(
      true,
    );
  });

  it('rejects a field assigned to the wrong section', () => {
    const config = createDefaultTemplateConfig('CI');
    const seller = config.sections.find((section) => section.key === 'seller');
    seller?.fields.push({ key: 'buyer.companyName', visible: true, required: false });
    expect(documentTemplateConfigSchema.safeParse(config).success).toBe(false);
  });
});
