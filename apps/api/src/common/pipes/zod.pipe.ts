import type { PipeTransform } from '@nestjs/common';
import { ApiError } from '../errors/api-error';
import type { ZodType } from 'zod';

export interface ZodPipeOptions {
  /** Keep unknown keys in the parsed result (used only for PII inspection). */
  keepOriginal?: boolean;
}

// Validates and narrows an external payload. Zod strips undeclared keys, so a
// client cannot inject `createdBy`, role ids or price fields into a handler
// (docs/05 §1, docs/07 §3).
export function zodPipe<T>(schema: ZodType<T>, options: ZodPipeOptions = {}) {
  return class ZodValidationPipe implements PipeTransform {
    transform(value: unknown): T {
      const result = schema.safeParse(value);
      if (!result.success) {
        const details: Record<string, string> = {};
        for (const issue of result.error.issues) {
          const path = issue.path.join('.') || '(root)';
          details[path] = issue.message;
        }
        throw ApiError.validation('Request payload failed validation.', details);
      }
      if (options.keepOriginal && typeof value === 'object' && value !== null) {
        return { ...(result.data as Record<string, unknown>), __raw: value } as T;
      }
      return result.data;
    }
  };
}
