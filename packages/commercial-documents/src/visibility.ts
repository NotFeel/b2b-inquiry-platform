import type { DocumentSectionKey } from './field-catalog';
import type { DocumentTemplateConfig } from './template-config';

export type { DocumentItemColumnKey, DocumentSectionKey } from './field-catalog';

export function isSectionVisible(
  config: DocumentTemplateConfig,
  sectionKey: DocumentSectionKey,
): boolean {
  return config.sections.find((section) => section.key === sectionKey)?.visible === true;
}

/**
 * An absent field is hidden. This prevents legacy or malformed configurations
 * from accidentally exposing a field that the editor did not explicitly enable.
 */
export function isFieldVisible(
  config: DocumentTemplateConfig,
  sectionKey: DocumentSectionKey,
  fieldKey: string,
): boolean {
  const section = config.sections.find((candidate) => candidate.key === sectionKey);
  if (!section?.visible) return false;
  return section.fields.find((field) => field.key === fieldKey)?.visible === true;
}

export function isItemColumnVisible(config: DocumentTemplateConfig, key: string): boolean {
  return config.itemColumns.find((column) => column.key === key)?.visible === true;
}

export function isItemColumnRequired(config: DocumentTemplateConfig, key: string): boolean {
  const column = config.itemColumns.find((candidate) => candidate.key === key);
  return column?.visible === true && column.required === true;
}

export function hasVisibleFields(
  config: DocumentTemplateConfig,
  sectionKey: DocumentSectionKey,
): boolean {
  const section = config.sections.find((candidate) => candidate.key === sectionKey);
  return Boolean(section?.visible && section.fields.some((field) => field.visible));
}
