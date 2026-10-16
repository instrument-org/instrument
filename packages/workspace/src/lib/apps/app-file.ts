import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { validateFolderName } from "../project-folder-name";
import { isRecord, splitFrontmatter } from "../skills";
import {
  type AppManifest,
  AppManifestSchema,
  type AppSlug,
  AppSlugSchema,
} from "./manifest";

/**
 * An app as its file holds it: `APP.md`, plain YAML front matter holding the
 * manifest over the guide, what the app is for and what the work needs from
 * the service.
 *
 * The guide is the body, so an app opened in a text editor reads as what it
 * is, and the manifest is in the open above it: no credential ever appears in
 * one, since `auth` only names how a stored credential is attached to a
 * request. It is the file hand-editing helps most, since fixing a broken
 * local server means changing `package`, `args` or `runtime`.
 *
 * An app's name is its folder's, so it is in no key here: renaming the folder
 * renames the app. Its `id` is the one opaque value in the file, and it has
 * to stay, because the credential store and the connection record are keyed
 * by it; without it a folder renamed in a file manager would orphan both.
 */

/** Where the person's apps are, a folder each at the workspace's top level. */
export { APPS_FOLDER_NAME } from "../../constants";

/**
 * An app in its folder. Capitalized like the one file that says what a
 * folder is in each of the six: a folder in `Apps/` without it is not an
 * app's.
 */
export const APP_FILE_NAME = "APP.md";

/**
 * The manifest keys this build writes, in the order it writes them: what the
 * app is and where it is, then how it is reached, then what it is called at
 * the service. A key not here is nobody else's business
 * ({@link AppFile.others}).
 */
const MANIFEST_KEYS = [
  "type",
  "url",
  "signIn",
  "package",
  "runtime",
  "args",
  "macApp",
  "auth",
  "headers",
  "test",
  "service",
  "account",
] as const;

/** The keys this build reads off the front matter, and so the ones that are nobody else's. */
const OWN_KEYS: ReadonlySet<string> = new Set<string>(["id", ...MANIFEST_KEYS]);

export interface AppFile {
  /** What the app is for, and what a request or a tool call has to get right. */
  guide: string;
  /** The app's slug, which the credential store and the connection record are keyed by. */
  id: AppSlug;
  /** How the service is reached, and nothing about whether it may be. */
  manifest: AppManifest;
  /**
   * Front matter this build does not write, kept as it was found. An app is
   * a file two programs write: a newer build, the phone, or the person with
   * an editor and a note of their own. Dropping a key on the way through
   * would lose their work silently, so what comes in unrecognized goes back
   * out, and it is left out of the manifest's hash.
   */
  others?: Record<string, unknown>;
}

/** What an `APP.md` turned out to be. */
export type AppFileRead =
  | { app: AppFile; kind: "app" }
  /** It names an app, and what it says about it cannot be read. */
  | { id: string; kind: "invalid"; message: string }
  /** It names no app: something else the person left in the folder. */
  | { kind: "none" };

/**
 * An app from the bytes of its file. One with no front matter at all, or
 * none naming an `id`, is something else in the folder rather than a broken
 * app, so it is read as nothing and listed nowhere.
 */
export function parseAppFile(text: string): AppFileRead {
  const split = splitFrontmatter(text);
  if (!split.ok) {
    return { kind: "none" };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(split.block) as unknown;
  } catch {
    // Front matter that is not YAML at all names no app, the way one with
    // none does: a `---` fence in a note the person left is not an app
    // saying it is broken.
    return { kind: "none" };
  }
  return appFileOf(isRecord(parsed) ? parsed : {}, { guide: split.body });
}

/**
 * An app from a loose record of what was said about it: its `id`, the keys
 * this build reads as the manifest, and the rest kept as `others`.
 *
 * Front matter is one such record, and the `app.json` a build before this one
 * wrote is another, which is why the coercion is here rather than in either
 * reader (`lib/apps-move.ts`).
 */
export function appFileOf(
  front: Record<string, unknown>,
  { guide = "" }: { guide?: string } = {},
): AppFileRead {
  const said = typeof front.id === "string" ? front.id.trim() : "";
  if (said === "") {
    return { kind: "none" };
  }
  const id = AppSlugSchema.safeParse(said);
  if (!id.success) {
    return {
      id: said,
      kind: "invalid",
      message: `"${said}" is not an app id (lowercase letters, digits, and hyphens).`,
    };
  }
  const manifest = AppManifestSchema.safeParse(
    Object.fromEntries(
      Object.entries(front).filter(
        ([key]) => key !== "id" && OWN_KEYS.has(key),
      ),
    ),
  );
  if (!manifest.success) {
    return {
      id: said,
      kind: "invalid",
      message: `${APP_FILE_NAME} is invalid: ${manifest.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    };
  }
  const others = Object.fromEntries(
    Object.entries(front).filter(([key]) => !OWN_KEYS.has(key)),
  );
  return {
    app: {
      guide: guide.trim(),
      id: id.data,
      manifest: manifest.data,
      ...(Object.keys(others).length > 0 ? { others } : {}),
    },
    kind: "app",
  };
}

/**
 * The file: the front matter, then the guide. Written whole every time, so
 * the file is only ever one app's worth of bytes rather than something
 * patched in place.
 *
 * The keys this build knows come first, in a fixed order, and a key it does
 * not know follows them with its value and its shape as they were found, so
 * one save to the next never moves what somebody else wrote.
 */
export function renderAppFile(app: AppFile): string {
  const front: Record<string, unknown> = { id: app.id };
  const manifest: Record<string, unknown> = app.manifest;
  for (const key of MANIFEST_KEYS) {
    if (manifest[key] !== undefined) {
      front[key] = manifest[key];
    }
  }
  for (const [key, value] of Object.entries(app.others ?? {})) {
    if (!(key in front)) {
      front[key] = value;
    }
  }
  // No line wrapping: a long line in an app's setup is a long line, and
  // folding one would change the file every time a different build wrote it.
  const block = stringifyYaml(front, { lineWidth: 0 }).trimEnd();
  const guide = app.guide.trim();
  return `---\n${block}\n---\n${guide ? `\n${guide}\n` : ""}`;
}

/**
 * The name a new app's folder can take: the service's own, made safe for a
 * folder, or with a number after it when another app has that name, which is
 * what two accounts of one service come to ("Gmail", then "Gmail 2").
 */
export function unusedAppName(raw: string, taken: readonly string[]): string {
  const base = appFolderName(raw);
  const keys = new Set(taken.map((name) => name.trim().toLowerCase()));
  if (!keys.has(base.toLowerCase())) {
    return base;
  }
  for (let n = 2; ; n += 1) {
    const name = `${base} ${n.toString()}`;
    if (!keys.has(name.toLowerCase())) {
      return name;
    }
  }
}

/**
 * A name as a folder can hold it: the characters a folder name cannot have
 * become a dash, and a name left with nothing becomes "App". The name comes
 * from the service or from the agent rather than from the person typing one,
 * so it is made safe rather than refused.
 */
function appFolderName(raw: string): string {
  const name = raw
    .trim()
    // eslint-disable-next-line no-control-regex
    .replaceAll(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/^\.+/, "")
    .replaceAll(/\s+/g, " ")
    .replace(/[. ]+$/, "");
  return validateFolderName(name, "App").isOk() ? name : "App";
}
