import { useQuery } from "@tanstack/react-query";
import { checkFavoriteAvailability, type FavoriteIdentity } from "@workspace/api-client-react";

export function useFavoriteAvailability(items: FavoriteIdentity[], online: boolean) {
  return useQuery({
    queryKey: ["favorite-availability", items],
    queryFn: ({ signal }) => checkFavoriteAvailability({ items }, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    }),
    enabled: online && items.length > 0,
    staleTime: query => query.state.data?.some(item => item.status === "unknown") ? 60_000 : 600_000,
    gcTime: 1_800_000,
    retry: false,
    refetchInterval: 600_000,
  });
}
