/** The chat list's narrowest beside a chat, as the inbox was. */
export const LIST_WIDTH_MIN = 320;
/** The least the chat keeps beside the list while the list is dragged wider, and the narrowest its composer still has room to write in. */
export const CHAT_WIDTH_MIN = 360;

/**
 * Whether a tab `tabWidth` wide lays the chat list over its chat: when the
 * list at the width it was left at (`listWidth`, never under its narrowest)
 * would leave the chat less than its narrowest beside it. None before the
 * tab has been measured.
 */
export function isListOver(tabWidth: number, listWidth: number): boolean {
  return (
    tabWidth > 0 &&
    tabWidth < Math.max(listWidth, LIST_WIDTH_MIN) + CHAT_WIDTH_MIN
  );
}
