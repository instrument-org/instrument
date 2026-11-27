import {
  resizeLoopWitnesses,
  watchResizeObservers,
} from "@/client/lib/resize-loop-witness";
import { afterEach } from "vitest";

/**
 * A ResizeObserver loop raises an error event with no `error` on it, which
 * Vitest only logs, so a test that resizes what an observer watches inside
 * the observer's step passes. The guard fails every such test instead,
 * naming the callback behind the loop (`resize-loop-witness.ts`). A test
 * that makes a loop on purpose takes it with `nextResizeLoop`.
 */
export function installResizeLoopGuard() {
  watchResizeObservers({ closely: true });
  window.addEventListener("error", (event) => {
    const witnesses = resizeLoopWitnesses(event.message);
    if (!witnesses) {
      return;
    }
    event.preventDefault();
    const claim = claims.shift();
    if (claim) {
      claim(witnesses);
    } else {
      loops.push(witnesses);
    }
  });
  afterEach(() => {
    claims.length = 0;
    const found = loops.splice(0);
    if (found.length > 0) {
      throw new Error(
        `${found.length.toString()} ResizeObserver loop(s):\n${found
          .map((witnesses) => witnesses.join("\n"))
          .join("\n---\n")}`,
      );
    }
  });
}

const loops: string[][] = [];
const claims: ((witnesses: string[]) => void)[] = [];

/** The witnesses of the next loop, which the guard then lets pass. */
export function nextResizeLoop(): Promise<string[]> {
  return new Promise((resolve) => {
    claims.push(resolve);
  });
}
