/**
 * What a chat's head does when asked from outside it: put its title into
 * the rename field, open its project picker, raise its delete dialog, or
 * put its tab away as its menu's Archive does.
 */
export type ChatHeadAsk = "archived" | "delete" | "project" | "rename";

/** The chat heads on screen, each by the tab it is drawn in. */
const heads = new Map<string, (ask: ChatHeadAsk) => void>();

/** Lists a tab's chat head while it is drawn; the function returned takes it off. */
export function listChatHead(
  tabId: string,
  answer: (ask: ChatHeadAsk) => void,
): () => void {
  heads.set(tabId, answer);
  return () => {
    if (heads.get(tabId) === answer) {
      heads.delete(tabId);
    }
  };
}

/** Asks the chat head of a tab for something; false where the tab draws none. */
export function askChatHead(tabId: string, ask: ChatHeadAsk): boolean {
  const answer = heads.get(tabId);
  answer?.(ask);
  return answer !== undefined;
}
