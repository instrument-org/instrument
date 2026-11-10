/**
 * Chromium reports "ResizeObserver loop completed with undelivered
 * notifications" when an observer's callback resizes something observed
 * in the same frame, but the error event carries no stack and no element, so
 * a report of it names nothing. This keeps a short record of the observer
 * callbacks that just ran (where each observer was made, and what it saw),
 * which `resizeLoopWitnesses` hands to the report.
 */

/** The message Chromium raises the loop with, matched as its start. */
const LOOP_MESSAGE = "ResizeObserver loop";

/** How many recent callbacks are kept, and how far back one still counts. */
const KEPT_CALLBACKS = 16;
const SAME_FRAME_MS = 50;
const TARGETS_PER_CALLBACK = 3;
const STACK_FRAMES = 4;

type Ran = { at: number; created: string; targets: Element[] };

const ran: Ran[] = [];

/** Wraps the window's `ResizeObserver` so every callback is noted as it runs. */
export function watchResizeObservers() {
  const Native = window.ResizeObserver;
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- absent under jsdom
  if (!Native) {
    return;
  }
  window.ResizeObserver = class extends Native {
    constructor(callback: ResizeObserverCallback) {
      const created = creationSite(new Error().stack);
      super((entries, observer) => {
        ran.push({
          at: performance.now(),
          created,
          targets: entries
            .slice(0, TARGETS_PER_CALLBACK)
            .map((entry) => entry.target),
        });
        if (ran.length > KEPT_CALLBACKS) {
          ran.shift();
        }
        callback(entries, observer);
      });
    }
  };
}

/**
 * For an error event that is the observer loop, one line per callback that
 * ran in its frame: where the observer was made and what it observed.
 * Undefined for any other error.
 */
export function resizeLoopWitnesses(message: unknown): string[] | undefined {
  if (typeof message !== "string" || !message.startsWith(LOOP_MESSAGE)) {
    return undefined;
  }
  const since = performance.now() - SAME_FRAME_MS;
  return ran
    .filter((entry) => entry.at >= since)
    .map(
      (entry) =>
        `${entry.targets.map(describeElement).join(", ")} ← ${entry.created}`,
    );
}

/** The frames that made the observer, the wrapper's own left out. */
function creationSite(stack: string | undefined): string {
  return (stack ?? "")
    .split("\n")
    .slice(2, 2 + STACK_FRAMES)
    .map((line) => line.trim().replace(/^at /, ""))
    .join(" < ");
}

/** An element and its parent as selectors, with no text from the page. */
function describeElement(element: Element): string {
  const parent = element.parentElement;
  return parent
    ? `${selectorOf(parent)} > ${selectorOf(element)}`
    : selectorOf(element);
}

function selectorOf(element: Element): string {
  const slot = element.getAttribute("data-slot");
  const classes = [...element.classList].slice(0, 4).map((name) => `.${name}`);
  return [
    element.tagName.toLowerCase(),
    element.id ? `#${element.id}` : "",
    slot ? `[data-slot=${slot}]` : "",
    ...classes,
  ].join("");
}
