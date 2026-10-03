import { APP_COMMAND } from "../shell-commands/app-command";
import { getWorkspaceConfig } from "../workspace-config";
import { type AppManifest } from "./manifest";
import { credentialOrigin } from "./origin-bound";

/**
 * The words that send the agent back to the user when a secret is stored for
 * one origin and the manifest now points at another.
 */
export function credentialMovedMessage({
  noun,
  savedFor,
  sendsTo,
}: {
  noun: "key" | "sign-in";
  savedFor: string;
  sendsTo: string;
}): string {
  return `The stored ${noun} was approved for ${savedFor}, and this manifest would send it to ${sendsTo}. A ${noun} only goes where the user gave it: ask for it again with connect_app.`;
}

export type AppCredentialLookup =
  | { kind: "moved"; savedFor: string; sendsTo: string }
  | { kind: "missing" }
  | { kind: "ok"; value: string };

/**
 * The app's stored key for the manifest as it stands, or why there is none to
 * send: never stored, or stored for an origin the manifest no longer names.
 */
export async function lookupAppCredential(
  slug: string,
  manifest: AppManifest,
): Promise<AppCredentialLookup> {
  const stored = await getWorkspaceConfig().apps.getCredential(slug);
  if (stored === null) {
    return { kind: "missing" };
  }
  const origin = credentialOrigin(manifest);
  if (stored.origin !== origin) {
    return { kind: "moved", savedFor: stored.origin, sendsTo: origin };
  }
  return { kind: "ok", value: stored.value };
}

/**
 * The key a request or a tool call sends, for an app whose auth takes one;
 * null when it takes none. Throws the words that send the agent back to
 * connect_app when the key is missing or approved for another origin.
 */
export async function requireAppCredential(
  slug: string,
  manifest: AppManifest,
): Promise<null | string> {
  if (manifest.auth.kind === "none" || manifest.auth.kind === "oauth") {
    return null;
  }
  const found = await lookupAppCredential(slug, manifest);
  switch (found.kind) {
    case "missing": {
      throw new Error(
        `"${slug}" has no key stored. Ask the user for one with connect_app, then \`${APP_COMMAND.name} test ${slug}\` after the note.`,
      );
    }
    case "moved": {
      throw new Error(credentialMovedMessage({ noun: "key", ...found }));
    }
    case "ok": {
      return found.value;
    }
  }
}
