import { describe, expect, it } from 'vitest';
import {
  buildCustomerChanges,
  maskCustomerValue,
  type EditableCustomerSnapshot,
  type EditableParty,
} from './order-customer-edit';

const party = (overrides: Partial<EditableParty> = {}): EditableParty => ({
  companyName: 'ACME',
  contactName: 'Bob',
  phone: '+14155552671',
  email: 'bob@example.com',
  taxId: 'US-123456',
  line1: '1 Market Street',
  line2: '',
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94105',
  countryCode: 'US',
  addressCountryCode: 'US',
  ...overrides,
});

const snapshot = (overrides: Partial<EditableCustomerSnapshot> = {}): EditableCustomerSnapshot => ({
  buyer: party(),
  consignee: party({ companyName: 'ACME Warehouse' }),
  buyerReference: 'PO-1',
  incotermCode: 'FOB',
  namedPlace: 'Shanghai',
  paymentTerms: 'T/T 30%',
  ...overrides,
});

describe('maskCustomerValue', () => {
  it('masks phone, tax id, email and address values', () => {
    expect(maskCustomerValue('buyer.phone', '+14155552671')).toBe('••••2671');
    expect(maskCustomerValue('buyer.taxId', 'US-123456')).toBe('••••3456');
    expect(maskCustomerValue('buyer.email', 'bob@example.com')).toBe('b•••@example.com');
    expect(maskCustomerValue('buyer.line1', '1 Market Street')).toBe('••••reet');
  });

  it('keeps non-sensitive display values readable', () => {
    expect(maskCustomerValue('buyer.companyName', 'ACME')).toBe('ACME');
    expect(maskCustomerValue('buyer.countryCode', 'US')).toBe('US');
  });
});

describe('buildCustomerChanges', () => {
  it('returns only changed fields and masks sensitive before/after values', () => {
    const changes = buildCustomerChanges(
      snapshot(),
      snapshot({
        buyer: party({ phone: '+14155559999', contactName: 'Alice' }),
        buyerReference: 'PO-2',
      }),
    );

    expect(changes.map((change) => change.field)).toEqual([
      'buyer.contactName',
      'buyer.phone',
      'buyerReference',
    ]);
    expect(changes.find((change) => change.field === 'buyer.phone')).toMatchObject({
      before: '••••2671',
      after: '••••9999',
    });
    expect(changes.find((change) => change.field === 'buyerReference')).toMatchObject({
      before: 'PO-1',
      after: 'PO-2',
    });
  });

  it('does not report unchanged or whitespace-only differences', () => {
    expect(
      buildCustomerChanges(snapshot(), snapshot({ buyer: party({ city: ' San Francisco ' }) })),
    ).toEqual([]);
  });
});
