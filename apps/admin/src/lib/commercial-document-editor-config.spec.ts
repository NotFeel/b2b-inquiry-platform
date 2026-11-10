import { createDefaultTemplateConfig } from '@b2b/commercial-documents';
import { describe, expect, it } from 'vitest';
import {
  visibleItemEditorColumns,
  visiblePartyFields,
  visibleShippingFields,
  visibleTotalsFields,
} from './commercial-document-editor-config';
import type { DocumentTemplateConfig } from './commercial-documents-api';

describe('commercial document editor template visibility', () => {
  it('returns only visible and configured party fields', () => {
    const config = createDefaultTemplateConfig('CI') as DocumentTemplateConfig;
    const buyer = config.sections.find((section) => section.key === 'buyer')!;
    buyer.fields.find((field) => field.key === 'buyer.phone')!.visible = false;
    buyer.fields.find((field) => field.key === 'buyer.taxId')!.visible = false;

    expect([...visiblePartyFields(config, 'buyer')]).toEqual([
      'companyName',
      'contactName',
      'email',
      'address',
    ]);
  });

  it('hides the whole party section when the template section is hidden', () => {
    const config = createDefaultTemplateConfig('CI') as DocumentTemplateConfig;
    config.sections.find((section) => section.key === 'consignee')!.visible = false;

    expect(visiblePartyFields(config, 'consignee').size).toBe(0);
  });

  it('filters item, shipping and totals fields from the selected template', () => {
    const config = createDefaultTemplateConfig('CI') as DocumentTemplateConfig;
    config.itemColumns.find((column) => column.key === 'items.hsCode')!.visible = false;
    config.sections
      .find((section) => section.key === 'shipping')!
      .fields.find((field) => field.key === 'shipping.method')!.visible = false;
    config.sections
      .find((section) => section.key === 'totals')!
      .fields.find((field) => field.key === 'totals.discount')!.visible = false;

    expect(visibleItemEditorColumns(config)).not.toContain('items.hsCode');
    expect([...visibleShippingFields(config)]).not.toContain('method');
    expect([...visibleTotalsFields(config)]).not.toContain('discountAmount');
  });
});
