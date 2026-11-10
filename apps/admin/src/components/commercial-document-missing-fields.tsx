'use client';

import { Badge } from '@b2b/ui';
import { commercialDocumentFieldLabel } from '../lib/commercial-document-labels';
import type {
  MissingFieldEntry,
  MissingFieldReport,
  MissingFieldSource,
} from '../lib/commercial-documents-api';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface CommercialDocumentMissingFieldsProps {
  report?: MissingFieldReport | null;
  missingFields?: string[];
  missingItemLines?: Array<{ lineNo: number; fields: string[] }>;
  templateName?: string | null;
  title?: string;
  t: Translate;
}

function mergeEntries(entries: MissingFieldEntry[]): MissingFieldEntry[] {
  const merged = new Map<string, MissingFieldEntry & { sources: Set<MissingFieldSource> }>();
  for (const entry of entries) {
    const existing = merged.get(entry.key);
    if (existing) {
      existing.sources.add(entry.source);
      continue;
    }
    merged.set(entry.key, { ...entry, sources: new Set([entry.source]) });
  }
  return [...merged.values()];
}

function mergedSources(
  entry: MissingFieldEntry | (MissingFieldEntry & { sources: Set<MissingFieldSource> }),
): Set<MissingFieldSource> {
  return 'sources' in entry ? entry.sources : new Set([entry.source]);
}

function SourceBadges({ sources, t }: { sources: Set<MissingFieldSource>; t: Translate }) {
  return (
    <>
      {[...sources].map((source) => (
        <Badge key={source} tone={source === 'BUSINESS_RULE' ? 'warning' : 'neutral'}>
          {t(`commercialDocuments.validation.sources.${source}`)}
        </Badge>
      ))}
    </>
  );
}

export function CommercialDocumentMissingFields({
  report,
  missingFields = [],
  missingItemLines = [],
  templateName,
  title,
  t,
}: CommercialDocumentMissingFieldsProps) {
  const businessKeys = new Set((report?.businessRequired ?? []).map((entry) => entry.key));
  const businessEntries = mergeEntries([
    ...(report?.businessRequired ?? []),
    ...(report?.templateRequired ?? []).filter((entry) => businessKeys.has(entry.key)),
  ]);
  const templateEntries = mergeEntries(
    (report?.templateRequired ?? []).filter((entry) => !businessKeys.has(entry.key)),
  );
  const conflicts = report?.templateVisibilityConflicts ?? [];
  const itemLines =
    report?.itemLineMissing ??
    missingItemLines.map((line) => ({
      lineNo: line.lineNo,
      fields: line.fields.map((key) => ({
        key,
        label: commercialDocumentFieldLabel(key, t),
        source: 'CI_ITEM_RULE' as const,
        lineNo: line.lineNo,
      })),
    }));
  const legacyBusiness =
    !report && missingFields.length > 0
      ? missingFields.map((key) => ({
          key,
          label: commercialDocumentFieldLabel(key, t),
          source: 'BUSINESS_RULE' as const,
        }))
      : [];
  const hasEntries =
    businessEntries.length > 0 ||
    templateEntries.length > 0 ||
    itemLines.length > 0 ||
    conflicts.length > 0 ||
    legacyBusiness.length > 0;

  if (!hasEntries) return null;

  return (
    <section className="alert alert-warning commercial-document-validation" aria-live="polite">
      <div className="row-between">
        <strong>{title ?? t('commercialDocuments.validation.title')}</strong>
        {templateName ? (
          <span className="muted">
            {t('commercialDocuments.validation.currentTemplate', { name: templateName })}
          </span>
        ) : null}
      </div>

      {businessEntries.length > 0 || legacyBusiness.length > 0 ? (
        <div className="commercial-document-validation-group">
          <h4>{t('commercialDocuments.validation.businessTitle')}</h4>
          <p className="muted">{t('commercialDocuments.validation.businessHint')}</p>
          <ul>
            {(businessEntries.length > 0 ? businessEntries : legacyBusiness).map((entry) => (
              <li key={entry.key}>
                <span>{entry.label || commercialDocumentFieldLabel(entry.key, t)}</span>
                <SourceBadges sources={mergedSources(entry)} t={t} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {templateEntries.length > 0 ? (
        <div className="commercial-document-validation-group">
          <h4>{t('commercialDocuments.validation.templateTitle')}</h4>
          <p className="muted">{t('commercialDocuments.validation.templateHint')}</p>
          <ul>
            {templateEntries.map((entry) => (
              <li key={entry.key}>
                <span>{entry.label || commercialDocumentFieldLabel(entry.key, t)}</span>
                <SourceBadges sources={mergedSources(entry)} t={t} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {itemLines.length > 0 ? (
        <div className="commercial-document-validation-group">
          <h4>{t('commercialDocuments.validation.itemTitle')}</h4>
          <p className="muted">{t('commercialDocuments.validation.itemHint')}</p>
          <ul>
            {itemLines.map((line) => (
              <li key={`line-${line.lineNo}`}>
                <strong>
                  {t('commercialDocuments.validation.itemLine', { line: line.lineNo })}
                </strong>
                <span className="commercial-document-validation-fields">
                  {line.fields.map((field) => (
                    <span key={`${line.lineNo}-${field.key}`}>
                      {field.label || commercialDocumentFieldLabel(field.key, t)}
                      <Badge tone="neutral">
                        {t(`commercialDocuments.validation.sources.${field.source}`)}
                      </Badge>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="commercial-document-validation-group">
          <h4>{t('commercialDocuments.validation.conflictTitle')}</h4>
          <p className="muted">{t('commercialDocuments.validation.conflictHint')}</p>
          <ul>
            {conflicts.map((conflict) => (
              <li key={conflict.key}>
                <span>{conflict.label || commercialDocumentFieldLabel(conflict.key, t)}</span>
                <Badge tone="danger">{t('commercialDocuments.validation.requiredButHidden')}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
