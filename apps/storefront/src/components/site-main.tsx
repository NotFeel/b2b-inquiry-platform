'use client';

import type { ReactNode } from 'react';
import { useInquiry } from './inquiry-list';

// Adds bottom padding while the fixed inquiry bar is visible so the last product
// row and the detail page footer are never covered (docs/16 §11).
export function SiteMain({ children }: { children: ReactNode }) {
  const { items } = useInquiry();
  return (
    <main className={`site-main ${items.length > 0 ? 'has-inquiry-bar' : ''}`} id="main">
      {children}
    </main>
  );
}
