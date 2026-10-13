import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

import { type Volume } from "./tab-location";

/**
 * The disks and cloud folders the Files sidebar lists under Locations,
 * which is what names the top of one
 * wherever a place is said: the location bar, and the tab's title. From the
 * cache the folder browser reads, so asking costs nothing once it has.
 */
export function useComputerVolumes(): undefined | Volume[] {
  return useQuery(rpcClient.workspace.computer.places.queryOptions()).data
    ?.volumes;
}
