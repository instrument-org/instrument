import type {
  MouseEventHandler,
  PointerEventHandler,
  MouseEvent as ReactMouseEvent,
} from "react";

export type ClickActivation = "pointer-down" | "release";

/**
 * Fires a control on primary mouse press instead of release.
 *
 * `click` stays the activation path: the press synthesizes one through
 * `HTMLElement.click()`, so native buttons, Radix's handler composition,
 * keyboard input and assistive technology keep the semantics they already had
 * and only the timing moves. The browser's own release click is then
 * suppressed so the action cannot run twice.
 *
 * Both the default and propagation are canceled on that suppressed click. A
 * synthesized click bubbles like any other, so an ancestor that activates on
 * release has already seen it once by the time the release arrives; without
 * `stopPropagation` that ancestor would run its handler a second time.
 *
 * Nesting an independently-activating control inside one of these still needs
 * `stopPropagation` on *its* `pointerdown`, or the press reaches both.
 */
export function immediateClickHandlers<T extends HTMLElement>({
  activation = "pointer-down",
  onClick,
  onPointerDown,
}: {
  activation?: ClickActivation;
  onClick?: MouseEventHandler<T>;
  onPointerDown?: PointerEventHandler<T>;
}) {
  if (activation === "release") {
    return { onClick, onPointerDown };
  }

  return {
    onClick: ((event) => {
      // A pointer-down control never acts on a real mouse click, whether or not
      // its own press got that far: a nested control that stops the press still
      // wants its click, and this element has already had its chance.
      if (isMouseClick(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClick?.(event);
    }) satisfies MouseEventHandler<T>,
    onPointerDown: ((event) => {
      onPointerDown?.(event);
      if (
        !event.defaultPrevented &&
        event.pointerType === "mouse" &&
        event.button === 0 &&
        // Ctrl-click is a context-menu gesture on macOS, and the browser
        // reports it as a primary button.
        !event.ctrlKey
      ) {
        event.currentTarget.click();
      }
    }) satisfies PointerEventHandler<T>,
  };
}

/**
 * True only for a click the browser produced from a real mouse press/release
 * pair. `HTMLElement.click()`, Enter, Space and assistive technology all report
 * `detail === 0`, which is what tells the release click apart from the
 * synthetic one a press dispatches.
 */
export function isMouseClick(event: ReactMouseEvent<HTMLElement>) {
  if (event.detail === 0) {
    return false;
  }

  const { nativeEvent } = event;
  return !("pointerType" in nativeEvent) || nativeEvent.pointerType === "mouse";
}
