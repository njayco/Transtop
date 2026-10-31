import type { Alert, Stop } from '@workspace/api-client-react';

/** Route-wide association only: the API does not identify affected stops. */
export function relevantAlerts(stops: Stop[], filters: { type?: string; agency?: string; serviceClass?: string } = {}): Alert[] {
  const routes = new Set(stops.flatMap(s => s.routes).filter(r =>
    (!filters.type || filters.type === 'all' || r.type === filters.type) &&
    (!filters.agency || (r.agencyId || r.id.split(':')[0]) === filters.agency) &&
    (!filters.serviceClass || filters.serviceClass === 'all' || r.serviceClass === filters.serviceClass)
  ).map(r => r.id));
  const unique = new Map<string, Alert>();
  for (const alert of stops.flatMap(s => s.alerts ?? [])) {
    if (!['delay', 'disruption'].includes(alert.severity) || !alert.routeIds.some(id => routes.has(id))) continue;
    const key = `${alert.source}|${alert.id}`;
    if (!unique.has(key)) unique.set(key, alert);
  }
  return [...unique.values()];
}
