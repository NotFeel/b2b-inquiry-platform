import { updateCommercialDocumentSchema } from '@b2b/validation';
import { describe, expect, it } from 'vitest';

describe('commercial document update payload contract', () => {
  it('accepts CBM precision persisted by the order and document models', () => {
    const result = updateCommercialDocumentSchema.safeParse({
      version: 1,
      templateVersionId: '71c8c027-854e-4692-83f8-dc7a82c93dff',
      shipping: { cbm: '0.1122885' },
      items: [
        {
          lineNo: 1,
          quantity: '288',
          unitPrice: '0.83',
          hsCode: '',
          cbm: '0.0725985',
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
