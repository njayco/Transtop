import { EntryPreview } from './_shared';

// PREVIEW FIXTURE props
export function Connecticut() {
  return <EntryPreview theme="connecticut" location={{ country: 'US', city: 'Hartford', region: null, theme: 'connecticut', operator: 'CTtransit', accuracy: 'approximate', matchedBy: 'city' } as const} />;
}
