/**
 * The words of the controls and places the agent names to the user, as the
 * app shows them. Each is read by the component that shows it and by every
 * sentence the agent is told it in, so a control renamed or a label reworded
 * reaches both. A control goes here only once the agent's text names it.
 */

/** The card `instrument window wait` raises: the page is done with, or skipped. */
export const WAIT_CARD_WORDS = { done: "Done", skip: "Skip" } as const;

/** The card `choose` raises: passing over the question on it. */
export const QUESTION_SKIP = "Skip";

/** Signing in to an app on its site: the button on the card, and the one over the site's tab once signed in. */
export const SITE_SIGN_IN_WORDS = { done: "Done", signIn: "Sign in" } as const;

/** Taking a page from the chat working in it, and giving it back. */
export const TAKEOVER_WORDS = {
  giveBack: "Continue",
  take: "Take over",
} as const;

/** What a folder, a place or an app is set to on the Permissions page of Settings. */
export const PERMISSION_LEVEL_WORDS = {
  allow: "Allowed",
  ask: "Ask first",
  never: "Not allowed",
} as const;

/** The list of what was lately closed, from the History button and New Tab's right-click. */
export const RECENTLY_CLOSED = "Recently Closed";

/** A tab's menu item that makes a tab group of it. */
export const MOVE_TO_NEW_TAB_GROUP = "Move to New Tab Group";

/**
 * Where a card waiting on the user stands, and a note about their plan. No
 * component reads it, since the layout is the place: `PermissionAsksFoot`
 * and `QuestionDock`, over the composer in `task/chat.tsx`.
 */
export const ABOVE_REPLY_BOX = "above the reply box";
