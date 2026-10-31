type EventData = {
  entry_completed: undefined;
  search_performed: { has_query: boolean };
  stop_viewed: { mode: string };
  route_viewed: { mode: string };
  favorite_changed: { kind: 'stop' | 'route'; action: 'added' | 'removed'; mode: string };
};

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: Record<string, string | number | boolean>): void | Promise<unknown>;
    };
  }
}

/** Only coarse interaction dimensions: never pass queries, coordinates or saved identities. */
export function trackEvent<E extends keyof EventData>(name: E, data?: EventData[E]): void {
  if (typeof window === 'undefined') return;
  try {
    const result = window.umami?.track(name, data);
    // Tracker/network failures must never interrupt a rider action.
    if (result && typeof result.catch === 'function') void result.catch(() => {});
  } catch { /* Analytics is optional. */ }
}
