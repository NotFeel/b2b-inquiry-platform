import {
  COMMERCIAL_DOCUMENT_STATUSES,
  COMMERCIAL_DOCUMENT_TYPES,
  DOCUMENT_ORIENTATIONS,
  DOCUMENT_PAPER_SIZES,
  DOCUMENT_TEMPLATE_STATUSES,
  INCOTERM_CODES,
  SUPPORTED_LOCALES,
} from '@b2b/contracts';
import { documentTemplateConfigSchema } from '@b2b/commercial-documents';
import { z } from 'zod';
import {
  codeSchema,
  countryCodeSchema,
  decimalStringSchema,
  emailSchema,
  localeSchema,
  nonEmptyText,
  optionalSafeUrlSchema,
  optionalText,
  paginationQuerySchema,
  uuidSchema,
} from './primitives';

// --------------------------------------------------------------- snapshots

export const documentAddressSchema = z.object({
  recipient: optionalText(160),
  companyName: optionalText(240),
  line1: optionalText(240),
  line2: optionalText(240),
  city: optionalText(120),
  state: optionalText(120),
  postalCode: optionalText(40),
  countryCode: countryCodeSchema.nullable().optional(),
});
export type DocumentAddressInput = z.infer<typeof documentAddressSchema>;

export const documentPartySchema = z.object({
  companyName: optionalText(240),
  contactName: optionalText(160),
  phone: optionalText(40),
  email: z
    .union([emailSchema, z.literal(''), z.null()])
    .optional()
    .transform((value) => (value ? value : null)),
  taxId: optionalText(60),
  countryCode: countryCodeSchema.nullable().optional(),
  address: documentAddressSchema.nullable().optional(),
  billingAddress: documentAddressSchema.nullable().optional(),
  shippingAddress: documentAddressSchema.nullable().optional(),
});
export type DocumentPartyInput = z.infer<typeof documentPartySchema>;

export const documentTradeSchema = z.object({
  incotermCode: z
    .union([z.enum(INCOTERM_CODES), z.literal(''), z.null()])
    .optional()
    .transform((value) => (value ? value : null)),
  namedPlace: optionalText(240),
  paymentTerms: optionalText(500),
  contractNo: optionalText(80),
  buyerReference: optionalText(120),
  exchangeRateText: optionalText(120),
});

export const documentShippingSchema = z.object({
  method: optionalText(120),
  portOfLoading: optionalText(120),
  portOfDischarge: optionalText(120),
  route: optionalText(240),
  transitTime: optionalText(120),
  cartonCount: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  netWeightKg: decimalStringSchema().nullable().optional(),
  grossWeightKg: decimalStringSchema().nullable().optional(),
  cbm: decimalStringSchema().nullable().optional(),
  marks: optionalText(500),
});

export const documentPaymentSchema = z.object({
  accountHolder: optionalText(240),
  bankName: optionalText(240),
  bankAddress: optionalText(500),
  accountNumber: optionalText(80),
  swiftCode: optionalText(40),
  wireRoutingNumber: optionalText(40),
  achRoutingNumber: optionalText(40),
});

export const documentDeclarationSchema = z.object({
  countryOfOrigin: countryCodeSchema.nullable().optional(),
  text: optionalText(2000),
  authenticityText: optionalText(2000),
});

export const documentSignatureSchema = z.object({
  sellerName: optionalText(160),
  sellerTitle: optionalText(120),
  stampAssetId: uuidSchema.nullable().optional(),
});

// ------------------------------------------------------- order correction

const orderAddressRequired = (address: DocumentAddressInput | null | undefined) =>
  Boolean(address?.line1 && address?.city && address?.countryCode);

export const updateOrderCustomerSnapshotSchema = z
  .object({
    version: z.coerce.number().int().min(1),
    buyer: documentPartySchema,
    consignee: documentPartySchema,
    notifyParty: documentPartySchema.nullable().optional(),
    buyerReference: optionalText(120),
    contractNo: optionalText(80),
    trade: documentTradeSchema.optional(),
  })
  .superRefine((value, context) => {
    if (!value.buyer.companyName && !value.buyer.contactName) {
      context.addIssue({
        code: 'custom',
        path: ['buyer', 'companyName'],
        message: 'validation.required',
      });
    }
    if (!value.buyer.phone) {
      context.addIssue({
        code: 'custom',
        path: ['buyer', 'phone'],
        message: 'validation.required',
      });
    }
    if (!orderAddressRequired(value.buyer.billingAddress)) {
      context.addIssue({
        code: 'custom',
        path: ['buyer', 'billingAddress'],
        message: 'validation.address.incomplete',
      });
    }
    if (!orderAddressRequired(value.consignee.shippingAddress)) {
      context.addIssue({
        code: 'custom',
        path: ['consignee', 'shippingAddress'],
        message: 'validation.address.incomplete',
      });
    }
  });
export type UpdateOrderCustomerSnapshotInput = z.infer<typeof updateOrderCustomerSnapshotSchema>;

export const syncOrderCustomerProfileSchema = z.object({
  version: z.coerce.number().int().min(1),
  confirm: z.literal(true),
});
export type SyncOrderCustomerProfileInput = z.infer<typeof syncOrderCustomerProfileSchema>;

export const orderDocumentPrefillQuerySchema = z.object({
  type: z.enum(COMMERCIAL_DOCUMENT_TYPES),
});
export type OrderDocumentPrefillQuery = z.infer<typeof orderDocumentPrefillQuerySchema>;

// ------------------------------------------------------ commercial documents

const documentItemInputSchema = z.object({
  lineNo: z.coerce.number().int().min(1).max(1000).optional(),
  productId: uuidSchema.nullable().optional(),
  sku: z.string().trim().max(64).default(''),
  description: optionalText(2000),
  hsCode: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9A-Za-z .-]*$/, 'validation.hsCode.invalid')
    .default(''),
  originCountryCode: countryCodeSchema.nullable().optional(),
  quantity: decimalStringSchema(),
  unit: z.string().trim().min(1).max(24).default('pcs'),
  unitPrice: decimalStringSchema(),
  discountAmount: decimalStringSchema().default('0'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  cartons: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  unitsPerCarton: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  netWeightKg: decimalStringSchema().nullable().optional(),
  grossWeightKg: decimalStringSchema().nullable().optional(),
  cbm: decimalStringSchema().nullable().optional(),
  packaging: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type CommercialDocumentItemInput = z.infer<typeof documentItemInputSchema>;

export const createCommercialDocumentSchema = z.object({
  documentType: z.enum(COMMERCIAL_DOCUMENT_TYPES),
  locale: localeSchema.default('en-US'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  templateVersionId: uuidSchema.nullable().optional(),
  companyProfileId: uuidSchema.nullable().optional(),
  bankAccountId: uuidSchema.nullable().optional(),
  issueDate: z.string().date().nullable().optional(),
});
export type CreateCommercialDocumentInput = z.infer<typeof createCommercialDocumentSchema>;

export const updateCommercialDocumentSchema = z.object({
  version: z.coerce.number().int().min(1),
  locale: localeSchema.optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  issueDate: z.string().date().nullable().optional(),
  validUntil: z.string().date().nullable().optional(),
  templateVersionId: uuidSchema.nullable().optional(),
  /** Seller company for validating the selected bank account. */
  companyProfileId: uuidSchema.nullable().optional(),
  /** When set, the server rebuilds paymentSnapshot from this enabled account. */
  bankAccountId: uuidSchema.nullable().optional(),
  seller: documentPartySchema.optional(),
  buyer: documentPartySchema.optional(),
  consignee: documentPartySchema.nullable().optional(),
  notifyParty: documentPartySchema.nullable().optional(),
  trade: documentTradeSchema.optional(),
  shipping: documentShippingSchema.optional(),
  payment: documentPaymentSchema.optional(),
  declaration: documentDeclarationSchema.optional(),
  signature: documentSignatureSchema.optional(),
  notes: optionalText(4000),
  items: z.array(documentItemInputSchema).min(1).max(500).optional(),
  discountAmount: decimalStringSchema().optional(),
  freightAmount: decimalStringSchema().optional(),
  insuranceAmount: decimalStringSchema().optional(),
  otherCharges: decimalStringSchema().optional(),
});
export type UpdateCommercialDocumentInput = z.infer<typeof updateCommercialDocumentSchema>;

export const commercialDocumentListQuerySchema = paginationQuerySchema.extend({
  type: z.union([z.literal('all'), z.enum(COMMERCIAL_DOCUMENT_TYPES)]).default('all'),
  status: z.union([z.literal('all'), z.enum(COMMERCIAL_DOCUMENT_STATUSES)]).default('all'),
  q: z.string().trim().max(120).optional(),
  orderId: uuidSchema.optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
});
export type CommercialDocumentListQuery = z.infer<typeof commercialDocumentListQuerySchema>;

export const cancelCommercialDocumentSchema = z.object({
  reason: optionalText(500),
});
export type CancelCommercialDocumentInput = z.infer<typeof cancelCommercialDocumentSchema>;

export const issueCommercialDocumentSchema = z.object({
  version: z.coerce.number().int().min(1).optional(),
});
export type IssueCommercialDocumentInput = z.infer<typeof issueCommercialDocumentSchema>;

// ------------------------------------------------------------ templates

export const documentTemplateListQuerySchema = paginationQuerySchema.extend({
  type: z.union([z.literal('all'), z.enum(COMMERCIAL_DOCUMENT_TYPES)]).default('all'),
  status: z.union([z.literal('all'), z.enum(DOCUMENT_TEMPLATE_STATUSES)]).default('all'),
  locale: localeSchema.optional(),
  q: z.string().trim().max(120).optional(),
});
export type DocumentTemplateListQuery = z.infer<typeof documentTemplateListQuerySchema>;

export const createDocumentTemplateSchema = z.object({
  name: nonEmptyText(180),
  documentType: z.enum(COMMERCIAL_DOCUMENT_TYPES),
  locale: localeSchema.default('en-US'),
  paperSize: z.enum(DOCUMENT_PAPER_SIZES).default('A4'),
  orientation: z.enum(DOCUMENT_ORIENTATIONS).default('portrait'),
  isDefault: z.boolean().default(false),
  description: optionalText(500),
  config: documentTemplateConfigSchema.optional(),
});
export type CreateDocumentTemplateInput = z.infer<typeof createDocumentTemplateSchema>;

export const updateDocumentTemplateSchema = z.object({
  name: nonEmptyText(180).optional(),
  locale: localeSchema.optional(),
  paperSize: z.enum(DOCUMENT_PAPER_SIZES).optional(),
  orientation: z.enum(DOCUMENT_ORIENTATIONS).optional(),
  isDefault: z.boolean().optional(),
  description: optionalText(500),
  status: z.enum(['DRAFT', 'DISABLED']).optional(),
  config: documentTemplateConfigSchema.optional(),
  expectedUpdatedAt: z.string().trim().max(40).optional(),
});
export type UpdateDocumentTemplateInput = z.infer<typeof updateDocumentTemplateSchema>;

export const documentTemplateStatusSchema = z.object({
  status: z.enum(['DRAFT', 'DISABLED']),
});
export type DocumentTemplateStatusInput = z.infer<typeof documentTemplateStatusSchema>;

export const documentTemplatePreviewSchema = z.object({
  documentType: z.enum(COMMERCIAL_DOCUMENT_TYPES).optional(),
  config: documentTemplateConfigSchema.optional(),
  locale: localeSchema.optional(),
});
export type DocumentTemplatePreviewInput = z.infer<typeof documentTemplatePreviewSchema>;

/** Validate the editor's temporary configuration without persisting a draft. */
export const documentTemplateValidateSchema = documentTemplatePreviewSchema;
export type DocumentTemplateValidateInput = z.infer<typeof documentTemplateValidateSchema>;

// ------------------------------------------------------ company / banks

export const createCompanyProfileSchema = z.object({
  code: codeSchema.optional(),
  companyName: nonEmptyText(240),
  contactName: optionalText(160),
  phone: optionalText(40),
  email: z
    .union([emailSchema, z.literal(''), z.null()])
    .optional()
    .transform((value) => (value ? value : null)),
  taxId: optionalText(60),
  website: optionalSafeUrlSchema,
  address: documentAddressSchema,
  logoAssetId: uuidSchema.nullable().optional(),
  stampAssetId: uuidSchema.nullable().optional(),
  isDefault: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type CreateCompanyProfileInput = z.infer<typeof createCompanyProfileSchema>;

export const updateCompanyProfileSchema = createCompanyProfileSchema.partial();
export type UpdateCompanyProfileInput = z.infer<typeof updateCompanyProfileSchema>;

const bankAccountCoreSchema = z.object({
  label: nonEmptyText(120),
  accountHolder: nonEmptyText(240),
  bankName: nonEmptyText(240),
  bankAddress: optionalText(500),
  // Historical accounts may keep a NULL country. New accounts require it.
  bankCountryCode: countryCodeSchema.nullable().optional(),
  accountNumber: nonEmptyText(80),
  swiftCode: optionalText(40),
  wireRoutingNumber: optionalText(40),
  achRoutingNumber: optionalText(40),
  // Historical accounts may keep a NULL currency. New accounts require it.
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional(),
  isDefault: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});

const assertBankAccountEnabledState = (
  value: { enabled?: boolean; isDefault?: boolean },
  context: z.RefinementCtx,
) => {
  if (value.enabled === false && value.isDefault === true) {
    context.addIssue({
      code: 'custom',
      path: ['isDefault'],
      message: 'validation.bankAccount.disabledCannotBeDefault',
    });
  }
};

/** New accounts must carry a dictionary-backed currency and country. */
export const createBankAccountWithoutCompanyIdSchema = bankAccountCoreSchema
  .extend({
    bankCountryCode: countryCodeSchema,
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
  })
  .superRefine(assertBankAccountEnabledState);
export type CreateBankAccountWithoutCompanyIdInput = z.infer<
  typeof createBankAccountWithoutCompanyIdSchema
>;

export const createBankAccountSchema = bankAccountCoreSchema
  .extend({
    companyProfileId: uuidSchema,
    bankCountryCode: countryCodeSchema,
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
  })
  .superRefine(assertBankAccountEnabledState);
export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>;

/**
 * Partial updates keep omitted fields untouched. Explicit `null` is allowed for
 * a historical country, but the service refuses clearing a value that exists.
 */
export const updateBankAccountSchema = z
  .object({
    label: nonEmptyText(120).optional(),
    accountHolder: nonEmptyText(240).optional(),
    bankName: nonEmptyText(240).optional(),
    bankAddress: optionalText(500),
    bankCountryCode: countryCodeSchema.nullable().optional(),
    accountNumber: nonEmptyText(80).optional(),
    swiftCode: optionalText(40),
    wireRoutingNumber: optionalText(40),
    achRoutingNumber: optionalText(40),
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    isDefault: z.boolean().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
  })
  .superRefine(assertBankAccountEnabledState);
export type UpdateBankAccountInput = z.infer<typeof updateBankAccountSchema>;

/**
 * Creates a company and its initial bank accounts in one transaction. A company
 * may have at most one default account per currency; it may have none.
 */
export const createCompanyProfileWithBankAccountsSchema = z
  .object({
    company: createCompanyProfileSchema,
    bankAccounts: z.array(createBankAccountWithoutCompanyIdSchema).max(50).default([]),
  })
  .superRefine((value, context) => {
    const defaultCurrencies = new Set<string>();
    value.bankAccounts.forEach((account, index) => {
      if (!account.isDefault) return;
      if (defaultCurrencies.has(account.currencyCode)) {
        context.addIssue({
          code: 'custom',
          path: ['bankAccounts', index, 'isDefault'],
          message: 'validation.bankAccount.duplicateDefaultCurrency',
        });
      }
      defaultCurrencies.add(account.currencyCode);
    });
  });
export type CreateCompanyProfileWithBankAccountsInput = z.infer<
  typeof createCompanyProfileWithBankAccountsSchema
>;

export const idQuerySchema = z.object({ id: uuidSchema });

/** The languages a document template may target. */
export const documentTemplateLocales = SUPPORTED_LOCALES;
