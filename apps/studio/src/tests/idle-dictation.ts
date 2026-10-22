import { type Dictation } from "@/client/hooks/use-dictation";
import { vi } from "vitest";

/**
 * A `useDictation` that stays idle, for a test rendering a box with a mic,
 * which would otherwise ask main whether someone is signed in.
 */
export function idleDictation(): Dictation {
  return {
    cancel: vi.fn(),
    live: undefined,
    phase: { kind: "idle" },
    start: vi.fn(),
    stop: vi.fn(),
    stream: undefined,
  };
}
