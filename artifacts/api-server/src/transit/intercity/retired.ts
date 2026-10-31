/** Retired archive identities must not fall through to another public service. */
export const isRetiredResearchId = (id?: string) => !!id?.startsWith("ibg:");
