import { type AppManifest } from "./manifest";

/** Where one key rides: a header of a request, its query string, or a local server's environment. */
export type KeyPlacement =
  | { envVar: string; kind: "env" }
  | { header: string; kind: "header" }
  | { kind: "basic"; user?: string | undefined }
  | { kind: "bearer" }
  | { kind: "query"; param: string };

/**
 * One key an app's setup asks for. An app that takes several names each by
 * the service's own word for it, which is what the user reads beside its
 * field and what it is stored under; an app's one key has no label.
 */
export interface AppKeySlot {
  label: string | undefined;
  placement: KeyPlacement;
}

/** A key's value with where it goes: what a request, a connection or a launch is handed. */
export interface PlacedKey {
  placement: KeyPlacement;
  value: string;
}

/** A key as the user gives it, before it is stored. */
export interface GivenKey {
  label?: string | undefined;
  value: string;
}

/** The keys an app's setup asks for, in its order; none for an app signed in to, or open. */
export function appKeySlots(manifest: AppManifest): AppKeySlot[] {
  if (manifest.type === "web") {
    return [];
  }
  const { auth } = manifest;
  switch (auth.kind) {
    case "keys": {
      return auth.keys.map(({ label, ...placement }) => ({ label, placement }));
    }
    case "none":
    case "oauth": {
      return [];
    }
    default: {
      return [{ label: undefined, placement: auth }];
    }
  }
}

/** The bearer token a signed-in app's request carries, placed as a key is. */
export function bearerKey(value: string): PlacedKey {
  return { placement: { kind: "bearer" }, value };
}
