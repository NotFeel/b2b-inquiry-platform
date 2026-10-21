'use client';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

export interface BadgeProps {
  tone?: BadgeTone;
  children: string;
  title?: string;
}

// Status is never communicated by colour alone: the tag always renders text
// (docs/06 §7).
export function Badge({ tone = 'neutral', children, title }: BadgeProps) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export type StatusToneMap = Record<string, BadgeTone>;

export interface StatusTagProps {
  value: string;
  label: string;
  toneMap?: StatusToneMap;
  fallbackTone?: BadgeTone;
}

export function StatusTag({ value, label, toneMap, fallbackTone = 'neutral' }: StatusTagProps) {
  const tone = toneMap?.[value] ?? fallbackTone;
  return (
    <Badge tone={tone} title={value}>
      {label}
    </Badge>
  );
}

export const PUBLISH_STATUS_TONES: StatusToneMap = {
  published: 'success',
  draft: 'neutral',
  unpublished: 'warning',
};

export const LIFECYCLE_STATUS_TONES: StatusToneMap = {
  available: 'success',
  preorder: 'info',
  discontinued: 'danger',
};

export const JOB_STATUS_TONES: StatusToneMap = {
  queued: 'neutral',
  processing: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancel_requested: 'warning',
  cancelled: 'neutral',
};

export const PI_STATUS_TONES: StatusToneMap = {
  draft: 'neutral',
  review: 'warning',
  issued: 'success',
  superseded: 'neutral',
  cancelled: 'danger',
};
