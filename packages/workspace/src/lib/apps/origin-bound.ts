import { type AppManifest } from "./manifest";

/**
 * A stored secret with the place it was approved to go. The manifest that
 * says where an app's requests go is the agent's to rewrite, so a secret is
 * never sent on the strength of the manifest alone: it goes only to the origin
 * recorded when the user handed it over, and anywhere else asks them again.
 */
export interface OriginBound<T> {
  origin: string;
  value: T;
}

/** An app's stored key, with the origin it was saved for. */
export type StoredAppCredential = OriginBound<string>;

/**
 * Where an app's credential goes under this manifest: the origin of its base
 * URL or server URL, or for a server that runs here, the package that would be
 * handed the key in its environment (its version left off, so an upgrade of
 * the same package keeps it), or for a web app, where its sign-in happens.
 */
export function credentialOrigin(manifest: AppManifest): string {
  switch (manifest.type) {
    case "api": {
      return new URL(manifest.baseUrl).origin;
    }
    case "mcp": {
      return new URL(manifest.url).origin;
    }
    case "mcp-local": {
      return `${manifest.runtime}-package:${packageName(manifest.runtime, manifest.package)}`;
    }
    case "web": {
      // No credential is ever stored for one; the origin is where the user
      // signs in, which the card shows.
      return new URL(manifest.signIn ?? manifest.url).origin;
    }
  }
}

/** The stored secret, when it was approved for this origin. */
export function boundTo<T>(
  stored: OriginBound<T> | null | undefined,
  origin: string,
): T | undefined {
  return stored?.origin === origin ? stored.value : undefined;
}

function packageName(runtime: "node" | "python", spec: string): string {
  if (runtime === "node") {
    // A scoped name starts with "@", so the version separator is the "@"
    // after the first character.
    const at = spec.indexOf("@", 1);
    return at === -1 ? spec : spec.slice(0, at);
  }
  return /^[\w.-]+/.exec(spec)?.[0] ?? spec;
}
