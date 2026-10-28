import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { z } from "zod";

import { type SessionMessage } from "../../schemas/session/message";
import { truncateMiddle } from "../truncate-buffer";

/**
 * An app's guide handed to the model in a bash call: which app, and a digest
 * of the guide as it was then. Recorded on the call's result where it
 * happens, so "the model has this app's current guide" is a bash result in
 * the window it is sent naming the app and the digest of the guide now. A
 * guide edited since no longer matches, and is handed over again.
 */
export const AppGuideHandOffSchema = z.object({
  app: z.string(),
  hash: z.string(),
});

export type AppGuideHandOff = z.output<typeof AppGuideHandOffSchema>;

/**
 * A hand-off as a command records it: with what it printed, which the bash
 * call checks against what the model is shown of its output, or none where
 * the model wrote the guide itself and has it in its own command.
 */
export type RecordedAppGuide = AppGuideHandOff & { printed?: string };

const storage = new AsyncLocalStorage<RecordedAppGuide[]>();

/** The digest a hand-off records, of the guide's text without surrounding blank lines. */
function appGuideHash(guide: string): string {
  return createHash("sha256").update(guide.trim()).digest("hex").slice(0, 32);
}

/** Runs a bash call with `recorded` collecting the guides its `app` commands hand over. */
export function withAppGuideHandOffs<T>(
  recorded: RecordedAppGuide[],
  run: () => T,
): T {
  return storage.run(recorded, run);
}

export function recordAppGuideHandOff({
  app,
  guide,
  printed,
}: {
  app: string;
  guide: string;
  /** The command's output carrying the guide; absent where the model wrote it. */
  printed?: string;
}): void {
  storage
    .getStore()
    ?.push({ app, hash: appGuideHash(guide), ...(printed ? { printed } : {}) });
}

/**
 * The hand-offs the model is shown whole in the call's `output`, which it is
 * sent cut down to its head and tail when long: one cut away, or never in the
 * output at all (its stderr sent to /dev/null, or into a pipe that filtered
 * it), is left out, so the next request hands the guide over again. One that
 * would be cut even printed alone is kept, since handing it over again could
 * show no more.
 */
export function appGuidesShown(
  recorded: readonly RecordedAppGuide[],
  output: string,
): AppGuideHandOff[] {
  const shown = truncateMiddle(output);
  return recorded
    .filter(
      ({ printed }) =>
        printed === undefined ||
        shown.content.includes(printed.trim()) ||
        truncateMiddle(printed).truncated,
    )
    .map(({ app, hash }) => ({ app, hash }));
}

/**
 * Whether a bash result in `messages` handed over any guide of this app's,
 * as it is now or as it was: for a gate that must not refuse again over a
 * guide whose words the server changes from one connection to the next.
 */
export function anyAppGuideHandedOver(
  messages: readonly SessionMessage.WithParts[],
  app: string,
): boolean {
  return messages.some((message) =>
    message.parts.some(
      (part) =>
        part.type === "tool-bash" &&
        part.state === "output-available" &&
        (part.output.appGuides ?? []).some((handOff) => handOff.app === app),
    ),
  );
}

/** Whether a bash result in `messages` handed over this app's `guide` as it is now. */
export function appGuideHandedOver(
  messages: readonly SessionMessage.WithParts[],
  app: string,
  guide: string,
): boolean {
  const hash = appGuideHash(guide);
  return messages.some((message) =>
    message.parts.some(
      (part) =>
        part.type === "tool-bash" &&
        part.state === "output-available" &&
        (part.output.appGuides ?? []).some(
          (handOff) => handOff.app === app && handOff.hash === hash,
        ),
    ),
  );
}
