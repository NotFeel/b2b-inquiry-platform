'use client';

import { TAG_COLOR_TOKENS } from '@b2b/contracts';
import { Badge, type BadgeTone } from './StatusTag';

/**
 * Style-token → badge tone mapping (docs/23 §4.2).
 *
 * This is a closed lookup, not a style string: a token coming from the database
 * is *looked up*, never interpolated into `style`, `className` or CSS. An
 * unknown or absent token degrades to the neutral badge, so a stale or
 * hand-edited database value cannot inject arbitrary styling.
 */
const TOKEN_TONES: Record<(typeof TAG_COLOR_TOKENS)[number], BadgeTone> = {
  'tag.neutral': 'neutral',
  'tag.brand': 'brand',
  'tag.success': 'success',
  'tag.warning': 'warning',
  'tag.info': 'info',
  'tag.danger': 'danger',
};

export function tagTone(colorToken: string | null | undefined): BadgeTone {
  if (!colorToken) return 'neutral';
  return TOKEN_TONES[colorToken as (typeof TAG_COLOR_TOKENS)[number]] ?? 'neutral';
}

export interface TagBadgeProps {
  label: string;
  colorToken?: string | null;
  title?: string;
}

/**
 * The one tag preview used by the admin table, the admin form and (for the same
 * look) the storefront, so a preview can never drift from what visitors see.
 */
export function TagBadge({ label, colorToken, title }: TagBadgeProps) {
  return (
    <Badge tone={tagTone(colorToken)} title={title}>
      {label}
    </Badge>
  );
}
