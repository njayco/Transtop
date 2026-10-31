export type FavoriteIdentity = { id: string; kind: "stop" | "route" };
export type AvailabilityResult = FavoriteIdentity & {
  status: "available" | "unavailable" | "unknown";
  message: string;
  currentName?: string;
  checkedAt: string;
};
export type Verdict = Pick<AvailabilityResult, "status" | "message" | "currentName">;
export const uncertain: Verdict = {
  status: "unknown",
  message: "Could not verify this source right now. Your saved item is kept; try again later.",
};

/** Shared across requests: bounded memory, single-flight lookups and no unbounded job queue. */
export function availabilityCache(lookup: (item: FavoriteIdentity) => Promise<Verdict>, now = Date.now) {
  const cache = new Map<string, { expires: number; result: AvailabilityResult }>();
  const pending = new Map<string, Promise<AvailabilityResult>>();
  let active = 0;
  async function check(item: FavoriteIdentity): Promise<AvailabilityResult> {
    const key = JSON.stringify([item.kind, item.id]);
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.result;
    const existing = pending.get(key);
    if (existing) return existing;
    // Sources also enforce their own persistent quotas. Busy work is not queued.
    if (active >= 2) return { ...item, ...uncertain, checkedAt: new Date(now()).toISOString() };
    active++;
    const work = (async () => {
      let verdict: Verdict;
      try { verdict = await lookup(item); } catch { verdict = uncertain; }
      const result = { ...item, ...verdict, checkedAt: new Date(now()).toISOString() };
      if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
      cache.set(key, { result, expires: now() + (verdict.status === "unknown" ? 60_000 : 600_000) });
      return result;
    })().finally(() => { active--; pending.delete(key); });
    pending.set(key, work);
    return work;
  }
  return async (items: FavoriteIdentity[]) => {
    // Sequential within each batch, at most two concurrent batches across callers.
    const results: AvailabilityResult[] = [];
    for (const item of items) results.push(await check(item));
    return results;
  };
}
