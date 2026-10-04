import { atomWithStorage } from "jotai/utils";

/**
 * Newer-model offers the user set aside, by `offerKeyOf` (this model,
 * offered that one). Someone on an older model may be there on purpose, and
 * an offer that came back every time the composer opened would read as
 * nagging. A release newer still is a different key, so it is offered once.
 */
export const dismissedModelOffersAtom = atomWithStorage<string[]>(
  "studio.dismissed-model-offers.v1",
  [],
);
