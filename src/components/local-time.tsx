'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** Renders a timestamp in the viewer's own time zone (falls back to UTC during SSR). */
export function LocalTime({ iso, mode = 'datetime' }: { iso: string | null | undefined; mode?: 'datetime' | 'date' | 'relative' }) {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  if (!iso) return <span>—</span>;
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions =
    mode === 'date'
      ? { day: '2-digit', month: 'short', year: '2-digit' }
      : { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' };
  let text = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: isClient ? undefined : 'UTC' }).format(d);
  if (mode === 'relative' && isClient) {
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    text = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`;
  }
  return (
    <time dateTime={iso} title={isClient ? d.toLocaleString() : iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
