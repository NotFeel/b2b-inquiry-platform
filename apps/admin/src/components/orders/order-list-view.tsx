'use client';

import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Pagination,
  Select,
} from '@b2b/ui';
import type { OrderDocumentSummary, OrderListRow } from '../../lib/commercial-documents-api';
import type { CalculatorExcelTemplateOption } from '../../lib/quotation-order-api';
import {
  activeOrderFilterChips,
  documentStatusLabel,
  documentStatusTone,
  formatOrderDate,
  formatOrderMoney,
  formatOrderQuantity,
  hasActiveOrderFilters,
  orderStatusLabel,
  orderStatusTone,
  type OrderFilterKey,
  type OrderListFilters,
} from '../../lib/order-list';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface OrderListViewProps {
  rows: OrderListRow[];
  loading: boolean;
  error: string | null;
  requestId: string | null;
  filters: OrderListFilters;
  searchInput: string;
  advancedOpen: boolean;
  templates: CalculatorExcelTemplateOption[];
  templateId: string;
  exportBusyId: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  canRead: boolean;
  canCreateDocument: boolean;
  canExport: boolean;
  canOpenCalculator: boolean;
  isMobile: boolean;
  locale: string;
  t: Translate;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  onToggleAdvanced: () => void;
  onChangeFilter: (key: OrderFilterKey, value: string) => void;
  onClearFilter: (key: OrderFilterKey) => void;
  onClearAll: () => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onOpenDetail: (id: string) => void;
  onCreateDocument: (type: 'PI' | 'CI', orderId: string) => void;
  onExport: (row: OrderListRow) => void;
  onTemplateChange: (id: string) => void;
  onOpenDocument: (id: string) => void;
  onOpenCalculator: () => void;
}

export function OrderListView(props: OrderListViewProps) {
  const {
    rows,
    loading,
    error,
    requestId,
    filters,
    searchInput,
    advancedOpen,
    templates,
    templateId,
    exportBusyId,
    page,
    pageSize,
    total,
    totalPages,
    canRead,
    canCreateDocument,
    canExport,
    canOpenCalculator,
    isMobile,
    locale,
    t,
    onSearchInputChange,
    onSearchSubmit,
    onToggleAdvanced,
    onChangeFilter,
    onClearFilter,
    onClearAll,
    onRefresh,
    onPageChange,
    onPageSizeChange,
    onOpenDetail,
    onCreateDocument,
    onExport,
    onTemplateChange,
    onOpenDocument,
    onOpenCalculator,
  } = props;

  const chips = activeOrderFilterChips(filters, t);
  const hasFilters = hasActiveOrderFilters(filters);
  const firstLoad = loading && rows.length === 0;

  if (!canRead) {
    return (
      <EmptyState
        variant="info"
        title={t('commercialDocuments.orders.permissionDenied')}
        description={t('commercialDocuments.orders.permissionDeniedHint')}
      />
    );
  }

  return (
    <>
      <section className="panel stack-sm" aria-label={t('commercialDocuments.orders.filters')}>
        <div className="row-between">
          <h2 className="order-list-heading">{t('commercialDocuments.orders.filters')}</h2>
          <div className="row-actions">
            {hasFilters ? (
              <Button size="sm" variant="ghost" onClick={onClearAll}>
                {t('commercialDocuments.orders.clearAll')}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={onToggleAdvanced} aria-expanded={advancedOpen}>
              {advancedOpen
                ? t('commercialDocuments.orders.hideAdvanced')
                : t('commercialDocuments.orders.showAdvanced')}
            </Button>
          </div>
        </div>

        <div className="form-grid">
          <Field label={t('commercialDocuments.orders.search')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={searchInput}
                onChange={(event) => onSearchInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSearchSubmit();
                  }
                }}
                maxLength={120}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.orders.status')}>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={filters.status}
                placeholder={t('commercialDocuments.orders.any')}
                options={[
                  {
                    value: 'CONFIRMED',
                    label: t('commercialDocuments.orderStatuses.confirmed'),
                  },
                  {
                    value: 'CANCELLED',
                    label: t('commercialDocuments.orderStatuses.cancelled'),
                  },
                ]}
                onChange={(event) => onChangeFilter('status', event.target.value)}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.orders.from')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="date"
                value={filters.from}
                onChange={(event) => onChangeFilter('from', event.target.value)}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.orders.to')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="date"
                value={filters.to}
                onChange={(event) => onChangeFilter('to', event.target.value)}
              />
            )}
          </Field>
        </div>

        {advancedOpen ? (
          <div className="form-grid order-list-advanced">
            <Field label={t('commercialDocuments.orders.currency')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={filters.currency}
                  onChange={(event) =>
                    onChangeFilter('currency', event.target.value.toUpperCase().slice(0, 3))
                  }
                  maxLength={3}
                />
              )}
            </Field>
            <Field label={t('commercialDocuments.orders.country')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={filters.country}
                  onChange={(event) =>
                    onChangeFilter('country', event.target.value.toUpperCase().slice(0, 2))
                  }
                  maxLength={2}
                />
              )}
            </Field>
            <Field label={t('commercialDocuments.orders.hasPi')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={filters.hasPi}
                  placeholder={t('commercialDocuments.orders.any')}
                  options={[
                    { value: 'true', label: t('commercialDocuments.orders.yes') },
                    { value: 'false', label: t('commercialDocuments.orders.no') },
                  ]}
                  onChange={(event) => onChangeFilter('hasPi', event.target.value)}
                />
              )}
            </Field>
            <Field label={t('commercialDocuments.orders.hasCi')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={filters.hasCi}
                  placeholder={t('commercialDocuments.orders.any')}
                  options={[
                    { value: 'true', label: t('commercialDocuments.orders.yes') },
                    { value: 'false', label: t('commercialDocuments.orders.no') },
                  ]}
                  onChange={(event) => onChangeFilter('hasCi', event.target.value)}
                />
              )}
            </Field>
          </div>
        ) : null}

        {chips.length > 0 ? (
          <ul className="order-filter-chips" aria-label={t('commercialDocuments.orders.activeFilters')}>
            {chips.map((chip) => (
              <li key={chip.key}>
                <span>
                  {chip.label}: <strong>{chip.value}</strong>
                </span>
                <button
                  type="button"
                  className="order-filter-chip-remove"
                  aria-label={t('commercialDocuments.orders.removeFilter', { label: chip.label })}
                  onClick={() => onClearFilter(chip.key)}
                >
                  ×
                </button>
              </li>
            ))}
            <li className="order-filter-chip-clear">
              <button type="button" className="link-button" onClick={onClearAll}>
                {t('commercialDocuments.orders.clearAll')}
              </button>
            </li>
          </ul>
        ) : null}

        <div className="order-export-group">
          <div>
            <span className="field-label">{t('commercialDocuments.orders.exportGroup')}</span>
            <p className="field-help">{t('commercialDocuments.orders.exportHint')}</p>
          </div>
          <label className="field order-export-template">
            <span className="field-label">{t('commercialDocuments.orders.exportTemplate')}</span>
            <Select
              value={templateId}
              disabled={templates.length === 0 || Boolean(exportBusyId)}
              options={templates.map((template) => ({
                value: template.id,
                label: `${template.name} v${template.version}`,
              }))}
              onChange={(event) => onTemplateChange(event.target.value)}
              aria-label={t('commercialDocuments.orders.exportTemplate')}
            />
          </label>
          {templates.length === 0 ? (
            <span className="field-help" role="status">
              {t('commercialDocuments.orders.noTemplate')}
            </span>
          ) : null}
        </div>
      </section>

      <section className="panel stack-sm" aria-live="polite" aria-busy={loading}>
        <div className="row-between">
          <h2 className="order-list-heading">{t('commercialDocuments.orders.results', { total })}</h2>
        </div>

        {loading && rows.length > 0 ? (
          <p className="muted" role="status">
            {t('commercialDocuments.orders.refreshing')}
          </p>
        ) : null}

        {error && rows.length > 0 ? (
          <div className="alert alert-error" role="alert">
            {error}
            {requestId ? <span className="mono"> · {requestId}</span> : null}
          </div>
        ) : null}

        {firstLoad ? (
          <LoadingState label={t('commercialDocuments.orders.loading')} rows={6} />
        ) : error && rows.length === 0 ? (
          <ErrorState
            title={t('commercialDocuments.orders.loadError')}
            description={error}
            retryLabel={t('common.retry')}
            onRetry={onRefresh}
            requestId={requestId}
            copyLabel={t('common.copy')}
            copiedLabel={t('common.copied')}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="search"
            title={hasFilters ? t('commercialDocuments.orders.noResults') : t('commercialDocuments.orders.emptyTitle')}
            description={
              hasFilters
                ? t('commercialDocuments.orders.noResultsHint')
                : t('commercialDocuments.orders.emptyHint')
            }
            action={
              hasFilters ? (
                <Button variant="secondary" size="sm" onClick={onClearAll}>
                  {t('commercialDocuments.orders.clearAll')}
                </Button>
              ) : canOpenCalculator ? (
                <Button size="sm" onClick={onOpenCalculator}>
                  {t('commercialDocuments.orders.openCalculator')}
                </Button>
              ) : undefined
            }
          />
        ) : isMobile ? (
          <OrderCards
            rows={rows}
            locale={locale}
            t={t}
            canCreateDocument={canCreateDocument}
            canExport={canExport}
            templateId={templateId}
            exportBusyId={exportBusyId}
            onOpenDetail={onOpenDetail}
            onCreateDocument={onCreateDocument}
            onExport={onExport}
            onOpenDocument={onOpenDocument}
          />
        ) : (
          <OrderTable
            rows={rows}
            locale={locale}
            t={t}
            canCreateDocument={canCreateDocument}
            canExport={canExport}
            templateId={templateId}
            exportBusyId={exportBusyId}
            onOpenDetail={onOpenDetail}
            onCreateDocument={onCreateDocument}
            onExport={onExport}
            onOpenDocument={onOpenDocument}
          />
        )}

        {rows.length > 0 ? (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            labels={{
              previous: t('common.previous'),
              next: t('common.next'),
              rowsPerPage: t('common.rowsPerPage'),
              range: t('list.range', {
                from: (page - 1) * pageSize + 1,
                to: Math.min(page * pageSize, total),
                total,
              }),
            }}
          />
        ) : null}
      </section>
    </>
  );
}

interface ListActionsProps {
  row: OrderListRow;
  t: Translate;
  canCreateDocument: boolean;
  canExport: boolean;
  templateId: string;
  exportBusyId: string;
  onOpenDetail: (id: string) => void;
  onCreateDocument: (type: 'PI' | 'CI', orderId: string) => void;
  onExport: (row: OrderListRow) => void;
}

function RowActions(props: ListActionsProps & { compact?: boolean }) {
  const {
    row,
    t,
    canCreateDocument,
    canExport,
    templateId,
    exportBusyId,
    onOpenDetail,
    onCreateDocument,
    onExport,
    compact,
  } = props;
  return (
    <div className="row-actions">
      <Button size="sm" variant={compact ? 'secondary' : 'ghost'} onClick={() => onOpenDetail(row.id)}>
        {t('commercialDocuments.orders.view')}
      </Button>
      {canCreateDocument && row.status === 'CONFIRMED' ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => onCreateDocument('PI', row.id)}>
            {t('commercialDocuments.orders.createPi')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onCreateDocument('CI', row.id)}>
            {t('commercialDocuments.orders.createCi')}
          </Button>
        </>
      ) : null}
      {canExport ? (
        <Button
          size="sm"
          variant="ghost"
          loading={exportBusyId === row.id}
          disabled={!templateId || Boolean(exportBusyId)}
          onClick={() => onExport(row)}
        >
          {t('commercialDocuments.orders.exportExcel')}
        </Button>
      ) : null}
    </div>
  );
}

function DocumentCell({
  document,
  t,
  onOpen,
}: {
  document: OrderDocumentSummary | null;
  t: Translate;
  onOpen: (id: string) => void;
}) {
  if (!document) {
    return <span className="muted">{t('commercialDocuments.orders.notCreated')}</span>;
  }
  return (
    <div className="order-document-cell">
      <button type="button" className="link-button mono" onClick={() => onOpen(document.id)}>
        {document.documentNo}
      </button>
      <span className="row-tight">
        <span>R{document.revisionNo}</span>
        <Badge tone={documentStatusTone(document.status)}>
          {documentStatusLabel(document.status, t)}
        </Badge>
      </span>
    </div>
  );
}

function OrderTable({
  rows,
  locale,
  t,
  canCreateDocument,
  canExport,
  templateId,
  exportBusyId,
  onOpenDetail,
  onCreateDocument,
  onExport,
  onOpenDocument,
}: {
  rows: OrderListRow[];
  locale: string;
  t: Translate;
  canCreateDocument: boolean;
  canExport: boolean;
  templateId: string;
  exportBusyId: string;
  onOpenDetail: (id: string) => void;
  onCreateDocument: (type: 'PI' | 'CI', orderId: string) => void;
  onExport: (row: OrderListRow) => void;
  onOpenDocument: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table orders-table">
        <thead>
          <tr>
            <th>{t('commercialDocuments.columns.orderNo')}</th>
            <th>{t('commercialDocuments.columns.customer')}</th>
            <th>{t('commercialDocuments.columns.country')}</th>
            <th>{t('commercialDocuments.columns.orderDate')}</th>
            <th>{t('commercialDocuments.columns.status')}</th>
            <th>{t('commercialDocuments.columns.items')}</th>
            <th className="align-right">{t('commercialDocuments.columns.total')}</th>
            <th>{t('commercialDocuments.columns.pi')}</th>
            <th>{t('commercialDocuments.columns.ci')}</th>
            <th>{t('commercialDocuments.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="row-tight">
                  <button type="button" className="link-button mono" onClick={() => onOpenDetail(row.id)}>
                    {row.orderNo}
                  </button>
                  <CopyButton
                    value={row.orderNo}
                    label={t('commercialDocuments.orders.copyOrderNo')}
                    copiedLabel={t('common.copied')}
                  />
                </div>
              </td>
              <td>
                <div className="order-customer-cell">
                  <strong>{row.buyer?.companyName || '—'}</strong>
                  <span className="muted">{row.buyer?.contactName || '—'}</span>
                </div>
              </td>
              <td>{row.buyer?.countryCode || '—'}</td>
              <td>{formatOrderDate(row.orderDate, locale)}</td>
              <td>
                <Badge tone={orderStatusTone(row.status)}>{orderStatusLabel(row.status, t)}</Badge>
              </td>
              <td>
                {row.itemSummary ? (
                  <span className="order-item-summary">
                    {t('commercialDocuments.orders.itemsSummary', {
                      lines: row.itemSummary.lineCount,
                      quantity: formatOrderQuantity(row.itemSummary.totalQuantity, locale),
                      cartons: formatOrderQuantity(String(row.itemSummary.totalCartons), locale),
                    })}
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className="align-right">
                <div className="order-amount-cell">
                  <strong className="mono">
                    {formatOrderMoney(row.totalAmountForeign, row.currencyCode, locale)}
                  </strong>
                  <span className="muted mono">
                    {formatOrderMoney(row.totalAmountCny, 'CNY', locale)}
                  </span>
                </div>
              </td>
              <td>
                <DocumentCell document={row.documents?.pi ?? null} t={t} onOpen={onOpenDocument} />
              </td>
              <td>
                <DocumentCell document={row.documents?.ci ?? null} t={t} onOpen={onOpenDocument} />
              </td>
              <td>
                <RowActions
                  row={row}
                  t={t}
                  canCreateDocument={canCreateDocument}
                  canExport={canExport}
                  templateId={templateId}
                  exportBusyId={exportBusyId}
                  onOpenDetail={onOpenDetail}
                  onCreateDocument={onCreateDocument}
                  onExport={onExport}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderCards({
  rows,
  locale,
  t,
  canCreateDocument,
  canExport,
  templateId,
  exportBusyId,
  onOpenDetail,
  onCreateDocument,
  onExport,
  onOpenDocument,
}: {
  rows: OrderListRow[];
  locale: string;
  t: Translate;
  canCreateDocument: boolean;
  canExport: boolean;
  templateId: string;
  exportBusyId: string;
  onOpenDetail: (id: string) => void;
  onCreateDocument: (type: 'PI' | 'CI', orderId: string) => void;
  onExport: (row: OrderListRow) => void;
  onOpenDocument: (id: string) => void;
}) {
  return (
    <ul className="order-card-list">
      {rows.map((row) => (
        <li key={row.id} className="order-card">
          <div className="order-card-head">
            <div className="row-tight">
              <button type="button" className="link-button mono" onClick={() => onOpenDetail(row.id)}>
                {row.orderNo}
              </button>
              <CopyButton
                value={row.orderNo}
                label={t('commercialDocuments.orders.copyOrderNo')}
                copiedLabel={t('common.copied')}
              />
            </div>
            <Badge tone={orderStatusTone(row.status)}>{orderStatusLabel(row.status, t)}</Badge>
          </div>
          <strong className="order-card-customer">{row.buyer?.companyName || '—'}</strong>
          <span className="muted">
            {row.buyer?.contactName || '—'} · {row.buyer?.countryCode || '—'}
          </span>
          <dl className="order-card-meta">
            <div>
              <dt>{t('commercialDocuments.columns.orderDate')}</dt>
              <dd>{formatOrderDate(row.orderDate, locale)}</dd>
            </div>
            <div>
              <dt>{t('commercialDocuments.columns.total')}</dt>
              <dd className="mono">
                {formatOrderMoney(row.totalAmountForeign, row.currencyCode, locale)}
              </dd>
            </div>
            <div>
              <dt>{t('commercialDocuments.columns.items')}</dt>
              <dd>
                {row.itemSummary
                  ? t('commercialDocuments.orders.itemsSummary', {
                      lines: row.itemSummary.lineCount,
                      quantity: formatOrderQuantity(row.itemSummary.totalQuantity, locale),
                      cartons: formatOrderQuantity(String(row.itemSummary.totalCartons), locale),
                    })
                  : '—'}
              </dd>
            </div>
          </dl>
          <div className="order-card-documents">
            <div className="order-card-document">
              <span className="muted">{t('commercialDocuments.columns.pi')}</span>
              <DocumentCell document={row.documents?.pi ?? null} t={t} onOpen={onOpenDocument} />
            </div>
            <div className="order-card-document">
              <span className="muted">{t('commercialDocuments.columns.ci')}</span>
              <DocumentCell document={row.documents?.ci ?? null} t={t} onOpen={onOpenDocument} />
            </div>
          </div>
          <RowActions
            row={row}
            t={t}
            canCreateDocument={canCreateDocument}
            canExport={canExport}
            templateId={templateId}
            exportBusyId={exportBusyId}
            onOpenDetail={onOpenDetail}
            onCreateDocument={onCreateDocument}
            onExport={onExport}
            compact
          />
        </li>
      ))}
    </ul>
  );
}
