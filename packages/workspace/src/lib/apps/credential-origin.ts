import { TOOL_NAMES } from "../../tools/name";
import { APP_COMMAND } from "../../model-text/commands/app-command";
import { getWorkspaceConfig } from "../workspace-config";
import { type AppManifest } from "./manifest";
import { appKeySlots, type GivenKey, type PlacedKey } from "./keys";
import { credentialOrigin } from "./origin-bound";
import { redactCredential, redactKeys } from "./request";

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
  return `The stored ${noun} was approved for ${savedFor}, and this manifest would send it to ${sendsTo}. A ${noun} only goes where the user gave it: ask for it again with ${TOOL_NAMES.connectApp}.`;
}

export type AppKeysLookup =
  | { kind: "moved"; savedFor: string; sendsTo: string }
  | { kind: "missing"; labels: string[] }
  | { keys: PlacedKey[]; kind: "ok" };

/**
 * The app's stored keys for the manifest as it stands, or why there are none
 * to send: one never stored, or one stored for an origin the manifest no
 * longer names. `trying` stands in for the stored ones it names, for a test
 * of keys before they are kept.
 */
export async function lookupAppKeys(
  slug: string,
  manifest: AppManifest,
  { trying = [] }: { trying?: GivenKey[] } = {},
): Promise<AppKeysLookup> {
  const stored = await getWorkspaceConfig().apps.getCredentials(slug);
  const origin = credentialOrigin(manifest);
  const keys: PlacedKey[] = [];
  const labels: string[] = [];
  let isMissing = false;
  for (const { label, placement } of appKeySlots(manifest)) {
    const named = (key: { label?: string | undefined }) => key.label === label;
    const given = trying.find(named);
    const kept = stored.find(named);
    if (given) {
      keys.push({ placement, value: given.value });
    } else if (kept === undefined) {
      isMissing = true;
      labels.push(...(label === undefined ? [] : [label]));
    } else if (kept.origin === origin) {
      keys.push({ placement, value: kept.value });
    } else {
      return { kind: "moved", savedFor: kept.origin, sendsTo: origin };
    }
  }
  return isMissing ? { kind: "missing", labels } : { keys, kind: "ok" };
}

/** That an app has no key stored, or which of its keys it has none of, to follow its name. */
export function hasNoKeyStored(labels: string[]): string {
  return labels.length === 0
    ? "has no key stored"
    : `has no ${labels.map((label) => `"${label}"`).join(" or ")} key stored`;
}

/**
 * The keys a request or a tool call sends, for an app whose auth takes any;
 * none when it takes none, as a web app never does. Throws the words that send the agent back to
 * connect_app when a key is missing or approved for another origin.
 */
export async function requireAppKeys(
  slug: string,
  manifest: AppManifest,
): Promise<PlacedKey[]> {
  if (appKeySlots(manifest).length === 0) {
    return [];
  }
  const found = await lookupAppKeys(slug, manifest);
  switch (found.kind) {
    case "missing": {
      throw new Error(
        `"${slug}" ${hasNoKeyStored(found.labels)}. Ask the user for one with ${TOOL_NAMES.connectApp}, then \`${APP_COMMAND.name} test ${slug}\` after the note.`,
      );
    }
    case "moved": {
      throw new Error(credentialMovedMessage({ noun: "key", ...found }));
    }
    case "ok": {
      return found.keys;
    }
  }
}

/** Whatever authenticates the app, taken out of anything the agent will read. */
export async function redactorFor(
  slug: string,
  manifest: AppManifest,
  keys: PlacedKey[],
) {
  const oauthTokens =
    manifest.type === "mcp" && manifest.auth.kind === "oauth"
      ? (await getWorkspaceConfig().apps.oauth?.store.getTokens(slug))?.value
      : undefined;
  return (text: string) => {
    let out = redactKeys(text, keys);
    out = redactCredential(out, oauthTokens?.access_token ?? null);
    return redactCredential(out, oauthTokens?.refresh_token ?? null);
  };
}
