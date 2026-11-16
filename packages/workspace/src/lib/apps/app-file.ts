import { validateFolderName } from "../project-folder-name";
import {
  type AppManifest,
  AppManifestSchema,
  type AppSlug,
  AppSlugSchema,
} from "./manifest";

/**
 * An app as an earlier build's `APP.md` held it, and as the apps store holds
 * it now (`store.ts`): its `id`, the manifest, the keys this build does not
 * read, and the guide. The file was plain YAML front matter holding the
 * manifest over the guide; the launch takes each one into the store
 * (`lib/apps-move.ts`), and nothing writes one.
 */

/** Where earlier builds kept the person's apps, a folder each at the workspace's top level. */
export { APPS_FOLDER_NAME } from "../../constants";

/** The file in each app's folder that said what the app was. */
export const APP_FILE_NAME = "APP.md";

/**
 * The manifest keys this build reads: what the app is and where it is, then
 * how it is reached, then what it is called at the service. A key not here is
 * nobody else's business ({@link AppFile.others}).
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

/** Whether a setup key is one this build reads, rather than one kept as it was found. */
export function isOwnSetupKey(key: string): boolean {
  return OWN_KEYS.has(key);
}

export interface AppFile {
  /** What the app is for, and what a request or a tool call has to get right. */
  guide: string;
  /** The app's slug, which the credential store and the connection record are keyed by. */
  id: AppSlug;
  /** How the service is reached, and nothing about whether it may be. */
  manifest: AppManifest;
  /**
   * Setup this build does not read, kept as it was found: a newer build's,
   * or a note the person left in an `APP.md`. Dropping a key on the way
   * through would lose it silently, so what comes in unrecognized goes back
   * out, and it is left out of the manifest's hash.
   */
  others?: Record<string, unknown>;
}

/** What a record of an app turned out to be. */
export type AppFileRead =
  | { app: AppFile; kind: "app" }
  /** It names an app, and what it says about it cannot be read. */
  | { id: string; kind: "invalid"; message: string }
  /** It names no app. */
  | { kind: "none" };

/**
 * An app from a loose record of what was said about it: its `id`, the keys
 * this build reads as the manifest, and the rest kept as `others`.
 *
 * Front matter is one such record, the `app.json` an earlier build wrote is
 * another, and an app's setup in the store a third, which is why the
 * coercion is here rather than in any one reader. `what` names the record in
 * a message saying it cannot be read.
 */
export function appFileOf(
  front: Record<string, unknown>,
  { guide = "", what = "The setup" }: { guide?: string; what?: string } = {},
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
      message: `${what} is invalid: ${manifest.error.issues
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
 * The name a new app can take: the service's own, made plain, or with a
 * number after it when another app has that name, which is what two
 * accounts of one service come to ("Gmail", then "Gmail 2").
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
