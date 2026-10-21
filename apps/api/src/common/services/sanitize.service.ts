import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

// Rich text coming from the admin UI is cleaned against a strict allow-list
// (docs/07 §3). Spreadsheet cells coming from the same source are prefixed when
// they could be interpreted as a formula (docs/08 §6).
const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'em',
    'ul',
    'ol',
    'li',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'a',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['https', 'mailto'],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
    }),
  },
  disallowedTagsMode: 'discard',
};

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

@Injectable()
export class SanitizeService {
  cleanRichText(html: string | null | undefined): string | null {
    if (!html) return null;
    const cleaned = sanitizeHtml(html, RICH_TEXT_OPTIONS).trim();
    return cleaned.length === 0 ? null : cleaned;
  }

  /**
   * Neutralise spreadsheet formula injection for any user-controlled text that
   * is written into an exported workbook.
   */
  escapeSpreadsheetValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (text.length === 0) return '';
    if (FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
      return `'${text}`;
    }
    return text;
  }

  stripTags(html: string | null | undefined): string | null {
    if (!html) return null;
    const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
    return text.trim().length === 0 ? null : text.trim();
  }
}
