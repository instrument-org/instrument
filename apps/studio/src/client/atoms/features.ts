import type { Features } from "@/shared/features";

import { logger } from "@/client/lib/logger";
import { rpcClient } from "@/client/rpc/client";
import { atom } from "jotai";

const defaultFeatures: Features = {
  bash_summary_chip: false,
  context_ring: false,
  external_browser: false,
  prompt_queue: false,
  skills: false,
};

async function listen(
  setAtom: (features: Features) => void,
  signal: AbortSignal,
) {
  const iterator = await rpcClient.features.live.getAll.call(undefined, {
    signal,
  });
  for await (const features of iterator) {
    setAtom(features);
  }
}

export const featuresAtom = atom(defaultFeatures);

featuresAtom.onMount = (setAtom) => {
  const controller = new AbortController();
  listen(setAtom, controller.signal).catch((error: unknown) => {
    if (!controller.signal.aborted) {
      logger.error("Error listening to feature updates", error);
    }
  });

  return () => {
    controller.abort();
  };
};
