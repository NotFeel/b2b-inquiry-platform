import {
  EXCEL_PDF_BUSINESS_TYPES,
  EXCEL_PDF_LIMITS,
  type ExcelPdfBusinessType,
} from '@b2b/contracts';
import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './primitives';

const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  // Reject separators and control characters before persisting display metadata.
  // eslint-disable-next-line no-control-regex
  .refine((value) => !/[/\\\u0000-\u001f\u007f]/.test(value), 'validation.fileName.invalid')
  .refine((value) => value.toLowerCase().endsWith('.xlsx'), 'validation.file.extension');

export const excelPdfUploadInitSchema = z.object({
  originalName: fileNameSchema,
  sizeBytes: z.coerce.number().int().min(1).max(EXCEL_PDF_LIMITS.maxUploadBytes),
  businessType: z.enum(EXCEL_PDF_BUSINESS_TYPES).default('other'),
  options: z.object({ layout: z.literal('workbook') }).default({ layout: 'workbook' }),
});
export type ExcelPdfUploadInitInput = z.infer<typeof excelPdfUploadInitSchema>;

export const excelPdfUploadIdSchema = z.object({ uploadId: uuidSchema });
export const excelPdfJobIdSchema = z.object({ id: uuidSchema });

export const excelPdfJobListQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum(['all', 'queued', 'processing', 'succeeded', 'failed', 'cancelled', 'expired'])
    .default('all'),
  businessType: z.enum(['all', ...EXCEL_PDF_BUSINESS_TYPES]).default('all'),
});
export type ExcelPdfJobListQueryInput = z.infer<typeof excelPdfJobListQuerySchema>;

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'validation.idempotencyKey.invalid');

export function parseIdempotencyKey(value: string | string[] | undefined): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = idempotencyKeySchema.safeParse(normalized);
  if (!parsed.success) throw new Error('validation.idempotencyKey.invalid');
  return parsed.data;
}

export function isExcelPdfBusinessType(value: string): value is ExcelPdfBusinessType {
  return (EXCEL_PDF_BUSINESS_TYPES as readonly string[]).includes(value);
}
