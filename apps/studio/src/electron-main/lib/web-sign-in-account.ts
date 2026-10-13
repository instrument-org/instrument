import { guests } from "@/electron-main/browser-view/guest-registry";

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * The one account the pages' titles name that no other app has, or nothing
 * when they name none or several. A signed-in mail app puts its address in
 * its title ("Inbox - jeremy@example.com - Gmail"), so the account a second
 * one signed in as is the address no app holds yet.
 */
export function accountInTitles(
  titles: readonly string[],
  claimed: ReadonlySet<string>,
): string | undefined {
  const found = new Set(
    titles.flatMap((title) =>
      [...title.matchAll(EMAIL)].map((match) => match[0].toLowerCase()),
    ),
  );
  const unclaimed = [...found].filter(
    (account) => !claimed.has(account.toLowerCase()),
  );
  return unclaimed.length === 1 ? unclaimed[0] : undefined;
}

/**
 * The account the window's browser shows signed in on `address`'s site, read
 * from the titles of the tabs open there, leaving out the accounts other apps
 * of the service already hold.
 */
export function accountSignedInOn(
  address: string,
  claimed: ReadonlySet<string>,
): string | undefined {
  const host = URL.parse(address)?.host;
  if (host === undefined) {
    return undefined;
  }
  const titles = [...guests.records()].flatMap((record) =>
    record.role === "webview" &&
    !record.contents.isDestroyed() &&
    URL.parse(record.contents.getURL())?.host === host
      ? [record.contents.getTitle()]
      : [],
  );
  return accountInTitles(titles, claimed);
}
