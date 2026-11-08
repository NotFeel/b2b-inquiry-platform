import { describe, expect, it } from 'vitest';
import {
  createCommercialDocumentSchema,
  documentTemplateListQuerySchema,
  documentTemplateValidateSchema,
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
    expect(createCommercialDocumentSchema.safeParse({ documentType: 'INVOICE' }).success).toBe(
      false,
    );
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

  it('accepts locale filtering and an unsaved validation payload', () => {
    expect(
      documentTemplateListQuerySchema.parse({
        page: '1',
        pageSize: '20',
        locale: 'zh-CN',
      }).locale,
    ).toBe('zh-CN');
    expect(
      documentTemplateValidateSchema.safeParse({
        documentType: 'CI',
        locale: 'en-US',
        config: createDefaultTemplateConfig('CI'),
      }).success,
    ).toBe(true);
  });
});

describe('bank account schemas', () => {
  const account = {
    label: 'USD Main',
    accountHolder: 'Example Co',
    bankName: 'Bank of China',
    bankAddress: '',
    bankCountryCode: 'CN',
    accountNumber: '1234567890',
    swiftCode: 'BKCHCNBJ',
    wireRoutingNumber: '',
    achRoutingNumber: '',
    currencyCode: 'USD',
    isDefault: true,
    enabled: true,
    sortOrder: 0,
  };

  it('requires currency and bank country for a new account', async () => {
    const { createBankAccountWithoutCompanyIdSchema } = await import('./commercial-documents');
    expect(createBankAccountWithoutCompanyIdSchema.safeParse(account).success).toBe(true);
    expect(
      createBankAccountWithoutCompanyIdSchema.safeParse({ ...account, currencyCode: undefined })
        .success,
    ).toBe(false);
    expect(
      createBankAccountWithoutCompanyIdSchema.safeParse({ ...account, bankCountryCode: undefined })
        .success,
    ).toBe(false);
  });

  it('rejects a disabled default account', async () => {
    const { createBankAccountWithoutCompanyIdSchema } = await import('./commercial-documents');
    const result = createBankAccountWithoutCompanyIdSchema.safeParse({
      ...account,
      enabled: false,
      isDefault: true,
    });
    expect(result.success).toBe(false);
  });

  it('allows one default per currency in combined company creation', async () => {
    const { createCompanyProfileWithBankAccountsSchema } = await import('./commercial-documents');
    const base = {
      company: {
        code: 'example',
        companyName: 'Example Co',
        address,
        isDefault: false,
        enabled: true,
      },
    };
    expect(
      createCompanyProfileWithBankAccountsSchema.safeParse({
        ...base,
        bankAccounts: [account, { ...account, currencyCode: 'EUR', isDefault: true }],
      }).success,
    ).toBe(true);
    expect(
      createCompanyProfileWithBankAccountsSchema.safeParse({
        ...base,
        bankAccounts: [account, { ...account, label: 'USD Backup' }],
      }).success,
    ).toBe(false);
  });
});
