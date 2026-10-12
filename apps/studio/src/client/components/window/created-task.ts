import { type StoreId } from "@instrument-org/workspace/client";

/**
 * The task a bash call's `task new` started, by its session, read off the
 * hand-offs the call recorded.
 */
export function createdTaskSession(part: {
  output?:
    | undefined
    | { handOffs?: { kind: string; sessionId: StoreId.Session }[] };
  state: string;
}): StoreId.Session | undefined {
  if (part.state !== "output-available") {
    return;
  }
  return part.output?.handOffs?.find((handOff) => handOff.kind === "created")
    ?.sessionId;
}
