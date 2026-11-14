import { chatOfAddress } from "./tab-identity";

/**
 * The tab a chat's agent works from: of the chat's tabs in a group an open
 * window lists, the one the person last sent it a message from
 * (`promptedAt`), else the first. Its agent's pages open right after it, and
 * its group is the one the agent sees by default. Undefined while no such
 * group has a tab on the chat: a chat whose only tabs are in a closed
 * window's groups gets a new group. The one rule the windows and main read
 * a chat's place by.
 */
export function workingTabOf<
  T extends { group?: string; href?: string; promptedAt?: number },
>(
  tabs: readonly T[],
  chat: string,
  isOpen: (group: string) => boolean,
): (T & { group: string }) | undefined {
  let found: (T & { group: string }) | undefined;
  for (const tab of tabs) {
    const { group, href } = tab;
    if (
      group === undefined ||
      href === undefined ||
      chatOfAddress(href) !== chat ||
      !isOpen(group)
    ) {
      continue;
    }
    if (
      found === undefined ||
      (tab.promptedAt ?? 0) > (found.promptedAt ?? 0)
    ) {
      found = { ...tab, group };
    }
  }
  return found;
}
