import {
  getNetworkStatus,
  recheckNetworkStatus,
} from "@/electron-main/lib/network-status";
import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { NetworkStatusSchema } from "@/shared/network-status";
import { liveRead } from "@instrument-org/workspace/electron";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

const live = {
  // Whether the computer is online and the platform API answers, for the
  // pill in the window's corner, with where the API is expected for
  // developer mode to name.
  status: base
    .output(
      eventIterator(
        z.object({
          platformApiBaseUrl: z.string(),
          status: NetworkStatusSchema,
        }),
      ),
    )
    .handler(async function* ({ signal }) {
      yield* liveRead({
        changes: [publisher.subscribe("network.status.updated", { signal })],
        read: () => ({
          platformApiBaseUrl: platformApiBaseUrl(),
          status: getNetworkStatus(),
        }),
      });
    }),
};

export const network = {
  live,
  // A window saw `online` or `offline`: main asks the OS again rather than
  // taking the window's word, so every window reads one status.
  recheck: base.handler(() => {
    recheckNetworkStatus();
  }),
};
