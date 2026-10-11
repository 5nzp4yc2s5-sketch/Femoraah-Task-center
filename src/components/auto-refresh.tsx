'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-fetches server data every minute and when the tab regains focus, so teammates' changes show up. */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) router.refresh();
    };
    const id = window.setInterval(tick, seconds * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, seconds]);
  return null;
}
