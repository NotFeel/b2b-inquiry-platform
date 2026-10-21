export interface OptionalContentPages {
  factory: boolean;
  quality: boolean;
  privacy: boolean;
}

/**
 * Converts administrator-managed HTML into a short plain-text summary.
 *
 * The input is only used as text (React escapes it), never injected as HTML.
 */
export function htmlToPlainText(html: string | null | undefined, maxLength = 260): string | null {
  if (!html) return null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}
