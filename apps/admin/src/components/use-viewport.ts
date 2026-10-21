'use client';

import { useEffect, useState } from 'react';
import { BREAKPOINT_DESKTOP, BREAKPOINT_TABLET, viewportFor, type Viewport } from '../lib/layout-state';

/**
 * Single source of breakpoint truth for the shell (docs/16 §8).
 *
 * The initial value is 'desktop' so the server and the first client render agree;
 * the real value is applied after mount. Sidebar width comes from CSS (including
 * the `auto` mode), so this cannot cause a hydration mismatch.
 */
export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>('desktop');

  useEffect(() => {
    const mobile = window.matchMedia(`(max-width: ${BREAKPOINT_TABLET - 1}px)`);
    const tablet = window.matchMedia(`(max-width: ${BREAKPOINT_DESKTOP - 1}px)`);
    const update = () => setViewport(viewportFor(window.innerWidth));
    update();
    mobile.addEventListener('change', update);
    tablet.addEventListener('change', update);
    window.addEventListener('orientationchange', update);
    return () => {
      mobile.removeEventListener('change', update);
      tablet.removeEventListener('change', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return viewport;
}
