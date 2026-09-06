/** Whether a key press landed somewhere that takes typing, so a shortcut should leave it alone. */
export function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}
