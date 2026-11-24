import { type DraftAsk } from "@/shared/drafts";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";

import { reachablePath } from "./file-tabs";
import { nameOf } from "./host-path";

/**
 * Asks as the message carries them, each file with the path the agent
 * reaches it by: a window's send of what a composer shows, and main's of a
 * draft another device asked for.
 */
export function asksPart(
  asks: readonly DraftAsk[],
  folders: Record<string, { path: string }>,
): SessionMessageDataPart.AsksDataPart | undefined {
  if (asks.length === 0) {
    return;
  }
  return {
    asks: asks.map((ask) => {
      const mount = reachablePath(ask.path, folders);
      return {
        ...(ask.context ? { context: ask.context } : {}),
        ...(ask.excerpt ? { excerpt: ask.excerpt } : {}),
        file: {
          ...(mount === undefined ? {} : { mount }),
          name: nameOf(ask.path),
          path: ask.path,
        },
        instruction: ask.instruction.trim(),
        target: ask.target,
      };
    }),
  };
}
