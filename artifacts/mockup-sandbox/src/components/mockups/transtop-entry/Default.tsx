import { EntryPreview } from './_shared';

// PREVIEW FIXTURE props
export function Default() {
  return <EntryPreview theme="default" location={{ country: 'US', city: null, region: null, theme: 'default', operator: null, accuracy: 'approximate', matchedBy: 'city' } as const} />;
}
