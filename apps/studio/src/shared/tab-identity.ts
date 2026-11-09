import { expandHomePath } from "@instrument-org/shared";

/**
 * What a tab's address shows, as one thing of which there is only one: a file
 * by its path, a folder in Files by its path, a chat, a draft, a task, the
 * apps, one app, the release notes, the extensions. Two addresses with the
 * same identity show the same thing however each tab has walked since (its
 * layout, its selection, the folder beside a file), so a tab at one is the
 * tab to bring forward for the other. Undefined for an address that is not
 * one of a kind: a site, the browser's start, the new tab, the inbox.
 *
 * `homeDir` reads a folder rooted at `~` as the folder it is, so a tab that
 * walked there from the home folder and one opened at its whole path agree.
 * Shared by the windows and main, which reads each window's kept tabs by it.
 */
export function tabIdentityOf(
  href: string,
  homeDir?: string,
): string | undefined {
  let url: URL;
  try {
    url = new URL(href, "http://tabs");
  } catch {
    return undefined;
  }
  const segments = url.pathname.split("/").filter(Boolean).map(decoded);
  const search = url.searchParams;
  const [first, second, ...below] = segments;
  if (below.length > 0) {
    return undefined;
  }
  switch (first) {
    case "apps": {
      return second === undefined ? "apps" : `app:${second}`;
    }
    case "chats": {
      if (second !== undefined) {
        return `chat:${second}`;
      }
      const draft = search.get("draft");
      return draft ? `draft:${draft}` : undefined;
    }
    case "activity":
    case "extensions":
    case "release-notes": {
      return second === undefined ? first : undefined;
    }
    case "files": {
      if (second !== undefined) {
        return undefined;
      }
      const file = search.get("file");
      if (file) {
        return `file:${spelled(file)}`;
      }
      const root = expandHomePath(search.get("root") ?? "~", homeDir);
      const path = search.get("path") ?? "";
      return `folder:${spelled(path === "" ? root : `${root}/${path}`)}`;
    }
    case "tasks": {
      return second === undefined ? undefined : `task:${second}`;
    }
    default: {
      return undefined;
    }
  }
}

/** Whether two addresses show the same one-of-a-kind thing. */
export function isSameTabIdentity(a: string, b: string, homeDir?: string) {
  const identity = tabIdentityOf(a, homeDir);
  return identity !== undefined && identity === tabIdentityOf(b, homeDir);
}

/** What an address's search says about which thing it is, rather than how it is shown. */
const IDENTIFYING_SEARCH: Record<string, readonly string[]> = {
  chats: ["draft"],
  files: ["file", "path", "root"],
  tasks: ["chat"],
};

/**
 * Whether an address asks more of the tab showing its thing than the tab
 * already shows: a search entry beyond what names the thing (a selection, a
 * `since`, the folder beside a file) that the tab's own address does not
 * have as asked. A tab found for such an address walks there; one found for
 * the bare address keeps the layout and selection it has.
 */
export function asksMoreThan(asked: string, shown: string): boolean {
  let want: URL;
  let have: URL;
  try {
    want = new URL(asked, "http://tabs");
    have = new URL(shown, "http://tabs");
  } catch {
    return false;
  }
  const first = want.pathname.split("/").find(Boolean) ?? "";
  const identifying = IDENTIFYING_SEARCH[first] ?? [];
  return [...want.searchParams].some(
    ([key, value]) =>
      !identifying.includes(key) && have.searchParams.get(key) !== value,
  );
}

/** A path spelled one way: forward slashes, none doubled, none trailing. */
function spelled(path: string) {
  const forward = path.replaceAll("\\", "/").replaceAll(/\/{2,}/g, "/");
  return forward.length > 1 ? forward.replace(/\/$/, "") : forward;
}

function decoded(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
