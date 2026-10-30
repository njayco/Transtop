import type { Arrival } from '@workspace/api-client-react';

export function clock(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function arrivalText(a: Pick<Arrival, 'minutes' | 'rangeMax' | 'scheduledAt' | 'source'>) {
  if (a.source === 'unavailable') return '—';
  if (a.minutes <= 0) return 'Due';
  if (a.rangeMax && a.rangeMax > a.minutes) return `${a.minutes}–${a.rangeMax} min`;
  if (a.minutes > 45 && a.scheduledAt) return clock(a.scheduledAt);
  return `${a.minutes} min`;
}

export function ago(iso: string | null | undefined) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(s)) return 'unknown';
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString();
}

export function distance(m: number) {
  if (m < 160) return `${Math.round(m * 3.281)} ft`;
  return `${(m / 1609.34).toFixed(m < 1609 ? 2 : 1)} mi`;
}

export const SOURCE_LABEL: Record<string, string> = {
  live: 'Live agency data',
  community: 'Community estimate',
  scheduled: 'Scheduled',
  demo: 'Demo data',
  unavailable: 'Unavailable',
};

export function statusTone(status: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  const s = status.toLowerCase();
  if (/(cancel|suspend|skip|major|no service)/.test(s)) return 'bad';
  if (/(delay|late|slow|reduced|minor|detour)/.test(s)) return 'warn';
  if (/(on time|good|normal|early)/.test(s)) return 'ok';
  return 'neutral';
}

export function severityTone(sev: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  const s = sev.toLowerCase();
  if (/(severe|major|high|critical)/.test(s)) return 'bad';
  if (/(warn|minor|moderate|medium|delay)/.test(s)) return 'warn';
  if (/(info|low)/.test(s)) return 'neutral';
  return 'warn';
}

export function textOn(hex: string) {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111' : '#fff';
}
