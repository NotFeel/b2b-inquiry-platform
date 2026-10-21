'use client';

// Deterministic line art used for category tiles and as the product-image
// fallback. It is a code-native asset (docs/16 §6.4: "统一线性图标或同一风格
// 彩色插画"), so it ships with the app instead of the upload pipeline - SVGs are
// deliberately rejected by the upload validator (docs/11 §3).

export type CategoryArtKind = 'bolt' | 'washer' | 'nut' | 'bearing' | 'box' | 'generic';

const ART_KINDS: CategoryArtKind[] = ['bolt', 'washer', 'nut', 'bearing', 'box', 'generic'];

export function artKindFor(seed: string | null | undefined): CategoryArtKind {
  if (!seed) return 'generic';
  const haystack = seed.toLowerCase();
  if (haystack.includes('bolt') || haystack.includes('screw') || haystack.includes('stud')) return 'bolt';
  if (haystack.includes('washer')) return 'washer';
  if (haystack.includes('nut')) return 'nut';
  if (haystack.includes('bearing') || haystack.includes('roller')) return 'bearing';
  if (haystack.includes('box') || haystack.includes('carton') || haystack.includes('pack')) return 'box';
  let hash = 0;
  for (let index = 0; index < haystack.length; index += 1) {
    hash = (hash * 31 + haystack.charCodeAt(index)) % 9973;
  }
  return ART_KINDS[hash % ART_KINDS.length] ?? 'generic';
}

export interface CategoryArtProps {
  seed?: string | null;
  kind?: CategoryArtKind;
  className?: string;
}

export function CategoryArt({ seed, kind, className }: CategoryArtProps) {
  const resolved = kind ?? artKindFor(seed);
  return (
    <svg
      viewBox="0 0 120 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      role="presentation"
    >
      <rect x="6" y="8" width="108" height="80" rx="10" stroke="none" fill="currentColor" opacity="0.06" />
      {resolved === 'bolt' ? (
        <>
          <path d="M38 22h44v14H38z" />
          <path d="M44 22v14M52 22v14M60 22v14M68 22v14M76 22v14" />
          <path d="M54 36h12v40H54z" />
          <path d="M50 76h20v6H50z" />
        </>
      ) : null}
      {resolved === 'washer' ? (
        <>
          <circle cx="60" cy="48" r="30" />
          <circle cx="60" cy="48" r="13" />
        </>
      ) : null}
      {resolved === 'nut' ? (
        <>
          <path d="M60 18 92 36v24L60 78 28 60V36z" />
          <circle cx="60" cy="48" r="12" />
        </>
      ) : null}
      {resolved === 'bearing' ? (
        <>
          <circle cx="60" cy="48" r="30" />
          <circle cx="60" cy="48" r="9" />
          <circle cx="60" cy="27" r="4.5" />
          <circle cx="78" cy="38" r="4.5" />
          <circle cx="78" cy="58" r="4.5" />
          <circle cx="60" cy="69" r="4.5" />
          <circle cx="42" cy="58" r="4.5" />
          <circle cx="42" cy="38" r="4.5" />
        </>
      ) : null}
      {resolved === 'box' ? (
        <>
          <path d="M24 34h72v44H24z" />
          <path d="M24 34l12-12h48l12 12" />
          <path d="M52 34h16v14H52z" />
        </>
      ) : null}
      {resolved === 'generic' ? (
        <>
          <rect x="24" y="22" width="72" height="52" rx="6" />
          <circle cx="46" cy="42" r="6" />
          <path d="m30 68 20-18 16 14 12-8 12 10" />
        </>
      ) : null}
    </svg>
  );
}
