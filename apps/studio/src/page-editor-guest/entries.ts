/** How long after an entry is told of the next telling waits. */
export const ENTRY_REPORT_GAP_MS = 1000;

/** The kinds of `input` a change to says nothing was entered: a toggle, a slider, a button. */
const NOT_ENTRY = new Set([
  "button",
  "checkbox",
  "color",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Whether a change to this element is something entered: text, a picked option, a chosen file. */
export function isEntry(target: EventTarget | undefined) {
  if (target instanceof HTMLInputElement) {
    return !NOT_ENTRY.has(target.type);
  }
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable === true)
  );
}

/**
 * Whether an `input` is text being edited, whatever it lands in: a field
 * inside a closed shadow root shows only its host to a listener outside.
 */
function isTextEdit(event: Event) {
  return event instanceof InputEvent && event.inputType !== "";
}

/**
 * Whether a document come back to (Back, Forward, a reload) has a field
 * holding other than what its page wrote there, which is the browser putting
 * back what was entered before.
 */
export function hasRestoredEntry(
  page: Document,
  arrivedBy: string | undefined,
) {
  if (arrivedBy !== "back_forward" && arrivedBy !== "reload") {
    return false;
  }
  return [...page.querySelectorAll("input, textarea, select")].some((field) => {
    if (field instanceof HTMLSelectElement) {
      return [...field.options].some(
        (option) => option.selected !== option.defaultSelected,
      );
    }
    return (
      (field instanceof HTMLTextAreaElement ||
        (field instanceof HTMLInputElement && isEntry(field))) &&
      field.value !== field.defaultValue
    );
  });
}

/**
 * Calls `tell` when something is entered into the page by real input: typed,
 * pasted, dictated or picked, which a script setting a value is not
 * (`isTrusted`). At once for the first, and again at most every
 * `ENTRY_REPORT_GAP_MS` while entries go on, the last of a run always told:
 * whoever listens leaves out what an agent's command entered, and has to
 * hear of a person's that follow. A page that comes back with what was
 * entered before (`hasRestoredEntry`) is told of once it is shown.
 */
export function watchEntries(
  page: Document,
  tell: () => void,
  {
    arrivedBy = () => {
      const [navigation] = performance.getEntriesByType("navigation");
      return navigation instanceof PerformanceNavigationTiming
        ? navigation.type
        : undefined;
    },
    isReal = (event) => event.isTrusted,
  }: {
    /** How the document was arrived at, as its navigation entry says. */
    arrivedBy?: () => string | undefined;
    isReal?: (event: Event) => boolean;
  } = {},
) {
  let quietUntil = 0;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  const say = () => {
    waiting = undefined;
    quietUntil = Date.now() + ENTRY_REPORT_GAP_MS;
    tell();
  };
  page.addEventListener(
    "input",
    (event) => {
      if (
        !isReal(event) ||
        waiting !== undefined ||
        !(isEntry(event.composedPath()[0]) || isTextEdit(event))
      ) {
        return;
      }
      const wait = quietUntil - Date.now();
      if (wait <= 0) {
        say();
      } else {
        waiting = setTimeout(say, wait);
      }
    },
    { capture: true, passive: true },
  );
  page.defaultView?.addEventListener(
    "pageshow",
    () => {
      if (hasRestoredEntry(page, arrivedBy())) {
        say();
      }
    },
    { once: true },
  );
}
