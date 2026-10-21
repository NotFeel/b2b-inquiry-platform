'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { sendAnalyticsEvent } from '../lib/api';

const SESSION_KEY = 'b2b.session.v1';
const HEARTBEAT_MS = 60_000;

/**
 * Anonymous session heartbeat and page view reporting.
 *
 * The identifier is random and local to the browser; no personal data and no
 * fingerprinting is used (docs/09 §5).
 */
export function AnalyticsTracker({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return undefined;
    let sessionId = window.localStorage.getItem(SESSION_KEY);
    if (!sessionId || sessionId.length < 16) {
      sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      window.localStorage.setItem(SESSION_KEY, sessionId);
    }

    void sendAnalyticsEvent({
      eventName: 'page_view',
      path: pathname,
      sessionId,
      context: { locale: document.documentElement.lang },
    });
    return undefined;
  }, [pathname, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const sessionId = window.localStorage.getItem(SESSION_KEY);
    if (!sessionId) return undefined;
    const interval = window.setInterval(() => {
      void sendAnalyticsEvent({ eventName: 'heartbeat', path: pathname, sessionId });
    }, HEARTBEAT_MS);
    return () => window.clearInterval(interval);
  }, [pathname, enabled]);

  return null;
}
