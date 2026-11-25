import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";

type SentChip = SessionMessageDataPart.SentChip;
type ViewContext = SessionMessageDataPart.ViewContextDataPart;

/**
 * What was beside the chat when a message was sent, as the chip the
 * transcript draws over it: a page, a file, a folder or what was selected in
 * it, or an app. Read from what every message already records, so a chat
 * written before the transcript drew it shows it too. A folder's paths may
 * start at `~`, as the person writes them. Nothing for a screen that is no
 * one thing (a new tab, the chat's own conversation) or a route the app no
 * longer has.
 */
export function seenChipOf(view: ViewContext): SentChip | undefined {
  switch (view.screen) {
    case "apps": {
      return view.app && view.url?.startsWith("/apps/")
        ? { kind: "screen", title: view.app.name, url: view.url }
        : undefined;
    }
    case "browser": {
      const url = view.page?.url ?? view.url;
      if (url === undefined || !/^https?:/i.test(url)) {
        return undefined;
      }
      return { kind: "page", title: view.page?.title || hostOf(url), url };
    }
    case "computer": {
      const { display, selected = [] } = view.folder ?? {};
      // A list named by a word rather than a path, such as the recents, is
      // no folder to open.
      if (display === undefined || !/^(?:[/\\~]|[a-z]:)/i.test(display)) {
        return undefined;
      }
      const [first, ...rest] = selected.map(
        (name) =>
          ({
            kind: /[/\\]$/.test(name) ? "folder" : "file",
            path: joined(display, name.replace(/[/\\]$/, "")),
          }) as const,
      );
      return {
        items: first ? [first, ...rest] : [{ kind: "folder", path: display }],
        kind: "paths",
      };
    }
    case "file": {
      return view.file
        ? { items: [{ kind: "file", path: view.file.path }], kind: "paths" }
        : undefined;
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Whether two chips name the same thing, whatever it was called at the time.
 * Two pages of one site with one title are the same thing, since an address
 * moves as someone goes through a form and their chips would read the same.
 */
export function isSameChip(a: SentChip, b: SentChip): boolean {
  if (keyOf(a) === keyOf(b)) {
    return true;
  }
  return (
    a.kind === "page" &&
    b.kind === "page" &&
    a.title === b.title &&
    hostOf(a.url) === hostOf(b.url)
  );
}

function hostOf(url: string): string {
  return URL.parse(url)?.host ?? url;
}

function joined(folder: string, name: string): string {
  const separator = /^(?:~?\\|[a-z]:\\)/i.test(folder) ? "\\" : "/";
  return folder.endsWith(separator)
    ? `${folder}${name}`
    : `${folder}${separator}${name}`;
}

function keyOf(chip: SentChip): string {
  switch (chip.kind) {
    case "chat": {
      return `chat:${chip.id}`;
    }
    case "page":
    case "screen": {
      return `${chip.kind}:${chip.url}`;
    }
    case "paths": {
      return `paths:${chip.items.map(({ path }) => path.replace(/[/\\]$/, "")).join("\n")}`;
    }
  }
}
