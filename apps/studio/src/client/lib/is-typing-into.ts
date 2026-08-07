// `isContentEditable` also covers `contenteditable=""` and `plaintext-only`,
// which an attribute selector alone would miss.
const EDITABLE_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/**
 * Whether this is somewhere the user is typing.
 *
 * A shortcut with no modifier is a character before it is a shortcut, so it has
 * to yield to whatever is being typed into. Every bare-key handler needs the
 * same test, and one that skips it swallows the key for the whole app: Studio is
 * a single web contents with every tab mounted at once, so a listener on
 * `window` in a background tab still runs in front of the composer.
 *
 * Takes an event target rather than reading `document.activeElement`, so it
 * answers for the element the key actually went to. `closest` rather than a
 * match, since the key can land on a wrapper inside the editable.
 */
export function isTypingInto(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest(EDITABLE_SELECTOR) !== null)
  );
}
