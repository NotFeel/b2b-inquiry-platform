// Shared contract for the CI/PI commercial-document centre (docs/41).
//
// A commercial document is an immutable business snapshot once issued. The
// template controls presentation only; totals, currency direction and required
// business fields are always recomputed or validated by the API.

export const COMMERCIAL_DOCUMENT_TYPES = ['PI', 'CI'] as const;
export type CommercialDocumentType = (typeof COMMERCIAL_DOCUMENT_TYPES)[number];

export const COMMERCIAL_DOCUMENT_STATUSES = [
  'DRAFT',
  'REVIEW',
  'ISSUED',
  'SUPERSEDED',
  'CANCELLED',
] as const;
export type CommercialDocumentStatus = (typeof COMMERCIAL_DOCUMENT_STATUSES)[number];

export const DOCUMENT_TEMPLATE_STATUSES = ['DRAFT', 'ACTIVE', 'DISABLED'] as const;
export type DocumentTemplateStatus = (typeof DOCUMENT_TEMPLATE_STATUSES)[number];

export const DOCUMENT_TEMPLATE_VERSION_STATUSES = ['DRAFT', 'PUBLISHED'] as const;
export type DocumentTemplateVersionStatus = (typeof DOCUMENT_TEMPLATE_VERSION_STATUSES)[number];

export const DOCUMENT_PAPER_SIZES = ['A4', 'Letter'] as const;
export type DocumentPaperSize = (typeof DOCUMENT_PAPER_SIZES)[number];

export const DOCUMENT_ORIENTATIONS = ['portrait', 'landscape'] as const;
export type DocumentOrientation = (typeof DOCUMENT_ORIENTATIONS)[number];

export const INCOTERM_CODES = [
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
] as const;
export type IncotermCode = (typeof INCOTERM_CODES)[number];

/** Business fields that must be present before a document may be issued. */
export const COMMERCIAL_DOCUMENT_REQUIRED_FIELDS = {
  buyerCompanyName: 'buyer.companyName',
  buyerAddress: 'buyer.address',
  sellerCompanyName: 'seller.companyName',
  sellerAddress: 'seller.address',
  incoterm: 'trade.incoterm',
  namedPlace: 'trade.namedPlace',
  paymentTerms: 'trade.paymentTerms',
  issueDate: 'document.issueDate',
  items: 'items',
  bankAccountHolder: 'payment.accountHolder',
  bankName: 'payment.bankName',
  bankAccountNumber: 'payment.accountNumber',
} as const;

/** Fields that only a Commercial Invoice needs for customs and shipping. */
export const COMMERCIAL_INVOICE_REQUIRED_FIELDS = {
  hsCode: 'items.hsCode',
  originCountryCode: 'items.originCountryCode',
  shippingMethod: 'shipping.method',
  cartons: 'shipping.cartonCount',
} as const;

export interface DocumentRenderJobPayload {
  jobId: string;
  attemptId: string;
}

/**
 * PDFs are private commercial records. The fixed prefix routes objects to the
 * private bucket through `storageVisibilityForKey` and is never user supplied.
 */
export function commercialDocumentPdfKey(
  documentId: string,
  revisionNo: number,
  attemptId: string,
): string {
  const safeRevision = Number.isInteger(revisionNo) && revisionNo > 0 ? revisionNo : 1;
  return `private/commercial-documents/${documentId}/r${safeRevision}-${attemptId}.pdf`;
}

export function commercialDocumentNumberPrefix(type: CommercialDocumentType): 'PI' | 'CI' {
  return type === 'CI' ? 'CI' : 'PI';
}
