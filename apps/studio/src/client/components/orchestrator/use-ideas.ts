import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import ms from "ms";

/**
 * The catalog, read from the registry the app ships. It changes with a build
 * and not while the app runs, so one read serves the window for a good while.
 */
export function ideasQueryOptions() {
  return rpcClient.ideas.list.queryOptions({ staleTime: ms("5 minutes") });
}

export function useIdeas() {
  return useQuery(ideasQueryOptions());
}
