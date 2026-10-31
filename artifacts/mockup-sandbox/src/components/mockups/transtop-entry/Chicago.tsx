import { EntryPreview } from './_shared';

// PREVIEW FIXTURE props
export function Chicago() {
  return <EntryPreview theme="chicago" location={{ country: 'US', city: 'Chicago', region: null, theme: 'chicago', operator: 'CTA', accuracy: 'approximate', matchedBy: 'city' } as const} />;
}
