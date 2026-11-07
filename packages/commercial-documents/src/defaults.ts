import { createDefaultTemplateConfig } from './template-config';

/** Stable codes for the built-in templates created on first use. */
export const BUILTIN_TEMPLATE_CODES = {
  PI: 'builtin-pi-en',
  CI: 'builtin-ci-en',
} as const;

export function builtinTemplateCode(documentType: 'PI' | 'CI', locale: string): string {
  const suffix = locale === 'zh-CN' ? 'zh-cn' : 'en';
  return `builtin-${documentType.toLowerCase()}-${suffix}`;
}

export function builtinTemplateName(documentType: 'PI' | 'CI'): string {
  return documentType === 'CI' ? 'Default Commercial Invoice' : 'Default Proforma Invoice';
}

export function builtinTemplateConfig(
  documentType: 'PI' | 'CI',
  locale: 'en-US' | 'zh-CN' = 'en-US',
) {
  return createDefaultTemplateConfig(documentType, locale);
}
