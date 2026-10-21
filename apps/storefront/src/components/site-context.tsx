'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface SiteContextValue {
  locale: string;
  /** Sales number from the global settings; null when it is not configured yet. */
  whatsappNumber: string | null;
  companyName: string;
}

const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteConfigProvider({ value, children }: { value: SiteContextValue; children: ReactNode }) {
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

// Exposes the site configuration to client components without threading props
// through every page. The WhatsApp number is never hardcoded in a component
// (docs/16 §6.7 step 5).
export function useSiteConfig(): SiteContextValue {
  const context = useContext(SiteContext);
  if (!context) {
    return { locale: 'en-US', whatsappNumber: null, companyName: '' };
  }
  return context;
}
