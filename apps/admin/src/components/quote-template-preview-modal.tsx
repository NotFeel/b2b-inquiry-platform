'use client';

import { useMemo, type CSSProperties } from 'react';
import type {
  QuoteTemplatePreview,
  QuoteTemplatePreviewCell,
  QuoteTemplateSummary,
} from '@b2b/contracts';
import { Button, ErrorState, LoadingState, Modal } from '@b2b/ui';
import { useSession } from './session-provider';

const ROW_HEADER_WIDTH = 44;
const COLUMN_HEADER_HEIGHT = 28;

interface QuoteTemplatePreviewModalProps {
  target: QuoteTemplateSummary | null;
  preview: QuoteTemplatePreview | null;
  loading: boolean;
  error: string | null;
  requestId: string | null;
  downloading: boolean;
  onClose: () => void;
  onRetry: () => void;
  onDownload: () => void;
}

interface MergeSpan {
  rowSpan: number;
  colSpan: number;
}

export function QuoteTemplatePreviewModal({
  target,
  preview,
  loading,
  error,
  requestId,
  downloading,
  onClose,
  onRetry,
  onDownload,
}: QuoteTemplatePreviewModalProps) {
  const { t } = useSession();
  const mergeLayout = useMemo(() => buildMergeLayout(preview?.merges ?? []), [preview?.merges]);
  const dimensions = useMemo(() => previewDimensions(preview), [preview]);

  return (
    <Modal
      open={target !== null}
      title={t('quoteTemplateManagement.previewTitle', {
        name: target?.name ?? '',
        version: target?.version ?? '',
      })}
      size="lg"
      closeLabel={t('common.close')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button disabled={!preview || downloading} loading={downloading} onClick={onDownload}>
            {t('quoteTemplateManagement.download')}
          </Button>
        </>
      }
    >
      {loading ? (
        <LoadingState label={t('quoteTemplateManagement.previewLoading')} rows={6} />
      ) : null}
      {!loading && error ? (
        <ErrorState
          title={t('quoteTemplateManagement.previewFailed')}
          description={error}
          retryLabel={t('common.retry')}
          onRetry={onRetry}
          requestId={requestId}
          copyLabel={t('common.copy')}
          copiedLabel={t('common.copied')}
        />
      ) : null}
      {!loading && !error && preview ? (
        <>
          <div className="row-between quote-preview-meta">
            <span>
              {t('quoteTemplateManagement.previewSheet', {
                sheet: preview.sheetName,
                rows: preview.rowCount,
                columns: preview.columnCount,
              })}
            </span>
            {preview.truncated ? (
              <span className="small muted">{t('quoteTemplateManagement.previewTruncated')}</span>
            ) : null}
          </div>
          <div className="quote-preview-scroll" tabIndex={0}>
            <div
              className="quote-preview-sheet"
              style={{ width: dimensions.width, height: dimensions.height }}
            >
              <table
                className="quote-preview-table"
                role="grid"
                aria-label={t('quoteTemplateManagement.previewGridLabel', {
                  sheet: preview.sheetName,
                })}
              >
                <colgroup>
                  <col style={{ width: ROW_HEADER_WIDTH }} />
                  {preview.columns.map((column) => (
                    <col
                      key={column.index}
                      style={{
                        width: Math.round(column.width * 7),
                        display: column.hidden ? 'none' : undefined,
                      }}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th
                      className="quote-preview-corner"
                      aria-label={t('quoteTemplateManagement.previewRowNumber')}
                    />
                    {preview.columns.map((column) => (
                      <th key={column.index} className="quote-preview-column-heading">
                        {column.letter}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr
                      key={row.index}
                      style={{
                        height: Math.round(row.height * 1.333),
                        display: row.hidden ? 'none' : undefined,
                      }}
                    >
                      <th className="quote-preview-row-heading">{row.index}</th>
                      {row.cells.map((cell) => {
                        const address = cell.address.toUpperCase();
                        if (mergeLayout.covered.has(address)) return null;
                        const span = mergeLayout.anchors.get(address);
                        return (
                          <PreviewCell
                            key={cell.address}
                            cell={cell}
                            rowSpan={span?.rowSpan}
                            colSpan={span?.colSpan}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.images.map((image, index) => {
                const row = preview.rows.find((entry) => entry.index === image.row);
                const position = imagePosition(preview, image.row, image.column);
                return (
                  <img
                    key={`${image.row}-${image.column}-${index}`}
                    className="quote-preview-image"
                    src={image.dataUrl}
                    alt={t('quoteTemplateManagement.previewImage', {
                      row: image.row,
                      column: image.column,
                    })}
                    style={{
                      left: position.left,
                      top: position.top,
                      width: image.width,
                      height: image.height,
                      maxHeight: row ? Math.round(row.height * 1.333) : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>
          <p className="small muted">{t('quoteTemplateManagement.previewHelp')}</p>
        </>
      ) : null}
    </Modal>
  );
}

function PreviewCell({
  cell,
  rowSpan,
  colSpan,
}: {
  cell: QuoteTemplatePreviewCell;
  rowSpan: number | undefined;
  colSpan: number | undefined;
}) {
  const style: CSSProperties = {
    backgroundColor: cell.style.fillColor ?? undefined,
    color: cell.style.fontColor ?? undefined,
    fontWeight: cell.style.bold ? 700 : undefined,
    fontStyle: cell.style.italic ? 'italic' : undefined,
    fontSize: cell.style.fontSize ? `${cell.style.fontSize}pt` : undefined,
    textAlign: cell.style.horizontal === 'justify' ? 'left' : (cell.style.horizontal ?? undefined),
    verticalAlign:
      cell.style.vertical === 'middle'
        ? 'middle'
        : cell.style.vertical === 'bottom'
          ? 'bottom'
          : 'top',
    whiteSpace: cell.style.wrapText ? 'pre-wrap' : 'nowrap',
    border: cell.style.border ? '1px solid var(--color-border-strong)' : undefined,
  };
  return (
    <td rowSpan={rowSpan} colSpan={colSpan} style={style} title={cell.value || undefined}>
      {cell.value || '\u00a0'}
    </td>
  );
}

function buildMergeLayout(merges: string[]): {
  anchors: Map<string, MergeSpan>;
  covered: Set<string>;
} {
  const anchors = new Map<string, MergeSpan>();
  const covered = new Set<string>();
  for (const merge of merges) {
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(merge.trim());
    if (!match) continue;
    const startColumn = columnNumber(match[1] ?? '');
    const startRow = Number(match[2]);
    const endColumn = columnNumber(match[3] ?? '');
    const endRow = Number(match[4]);
    if (
      startColumn <= 0 ||
      endColumn < startColumn ||
      !Number.isInteger(startRow) ||
      endRow < startRow
    ) {
      continue;
    }
    anchors.set(`${columnLetter(startColumn)}${startRow}`, {
      rowSpan: endRow - startRow + 1,
      colSpan: endColumn - startColumn + 1,
    });
    for (let row = startRow; row <= endRow; row += 1) {
      for (let column = startColumn; column <= endColumn; column += 1) {
        const address = `${columnLetter(column)}${row}`;
        if (address !== `${columnLetter(startColumn)}${startRow}`) covered.add(address);
      }
    }
  }
  return { anchors, covered };
}

function previewDimensions(preview: QuoteTemplatePreview | null): {
  width: number;
  height: number;
} {
  if (!preview) return { width: 0, height: 0 };
  const width =
    ROW_HEADER_WIDTH +
    preview.columns.reduce(
      (total, column) => total + (column.hidden ? 0 : Math.round(column.width * 7)),
      0,
    );
  const height =
    COLUMN_HEADER_HEIGHT +
    preview.rows.reduce(
      (total, row) => total + (row.hidden ? 0 : Math.round(row.height * 1.333)),
      0,
    );
  return { width, height };
}

function imagePosition(
  preview: QuoteTemplatePreview,
  row: number,
  column: number,
): { left: number; top: number } {
  const left =
    ROW_HEADER_WIDTH +
    preview.columns
      .filter((entry) => entry.index < column && !entry.hidden)
      .reduce((total, entry) => total + Math.round(entry.width * 7), 0);
  const top =
    COLUMN_HEADER_HEIGHT +
    preview.rows
      .filter((entry) => entry.index < row && !entry.hidden)
      .reduce((total, entry) => total + Math.round(entry.height * 1.333), 0);
  return { left, top };
}

function columnNumber(letters: string): number {
  return letters
    .toUpperCase()
    .split('')
    .reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
}

function columnLetter(column: number): string {
  let value = column;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}
