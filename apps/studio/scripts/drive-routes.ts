// Addresses of the app window's screens, for the scripts that drive it
// (`.agents/skills/studio-chrome-devtools/scripts`). Every path is typed
// against the route tree, so a route renamed or removed is a type error here
// rather than a probe that measures a "Page not found" screen. The scripts are
// plain JavaScript and take each address by its named export, so a name that
// is not here fails as the script loads.
//
// Node runs this file with its types stripped; it has only type imports, so
// nothing of the app loads with it.

import type { RegisteredRouter } from "@tanstack/react-router";

type Routes = RegisteredRouter["routesByPath"];

/** A path of the route tree, as the router writes it: `/files`, `/chats/$id`. */
type RoutePath = keyof Routes;

/** The parameters a path template names, by name. */
type ParamsOf<T extends string> =
  T extends `${string}$${infer Param}/${infer Rest}`
    ? Record<Param, string> & ParamsOf<Rest>
    : T extends `${string}$${infer Param}`
      ? Record<Param, string>
      : Record<never, string>;

/** What a route's search takes, as its address writes it. */
type SearchOf<T extends RoutePath> = Partial<
  Record<keyof Routes[T]["types"]["fullSearchSchemaInput"], number | string>
>;

type HrefOptions<T extends RoutePath> = (keyof ParamsOf<T> extends never
  ? { params?: undefined }
  : { params: ParamsOf<T> }) & { search?: SearchOf<T> };

/**
 * The address of a screen: its route with the parameters filled in, each
 * encoded, and its search after.
 */
export function href<T extends RoutePath>(
  to: T,
  ...[options]: keyof ParamsOf<T> extends never
    ? [HrefOptions<T>?]
    : [HrefOptions<T>]
): string {
  const params: Partial<Record<string, string>> = options?.params ?? {};
  const path = to
    .split("/")
    .map((segment) =>
      segment.startsWith("$")
        ? encodeURIComponent(params[segment.slice(1)] ?? "")
        : segment,
    )
    .join("/");
  const search = new URLSearchParams(
    Object.entries(options?.search ?? {}).map(([key, value]) => [
      key,
      String(value),
    ]),
  ).toString();
  return search === "" ? path : `${path}?${search}`;
}

/** A new tab: a new chat. */
export const newTabHref = () => href("/chats/");

/** Files at a folder (`path` under `root`), or with a `file` open. */
export const filesHref = (search: SearchOf<"/files">) =>
  href("/files", { search });

export const browserHref = () => href("/browser");

export const appsHref = () => href("/apps/");

export const appHref = (slug: string) =>
  href("/apps/$slug", { params: { slug } });

/** Every chat there is. */
export const chatListHref = () => href("/chat-list");

export const chatHref = (id: string) => href("/chats/$id", { params: { id } });

/** A task, by its session, in its chat. */
export const taskHref = (sessionId: string, chat: string) =>
  href("/tasks/$sessionId", { params: { sessionId }, search: { chat } });

export const settingsHref = () => href("/settings/");

export const releaseNotesHref = () => href("/release-notes");

export const extensionsHref = () => href("/extensions");

export const skillsHref = () => href("/skills");

export const memoryHref = () => href("/memory");
