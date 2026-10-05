import {
  type AppCatalogEntry,
  catalogEntryLocalServer,
  catalogEntryMacApp,
  catalogEntryMcpEndpoint,
} from "./catalog";
import { type CalledAppManifest } from "./manifest";

/** How a service is reached: one decision, shared by the index and the detail. */
export type CatalogWayIn =
  | { auth: string; endpoint: string; kind: "api"; test?: string }
  | { auth?: string; endpoint: string; kind: "mcp" }
  | { bundleId: string; kind: "mac-app"; name: string }
  | { kind: "web"; signIn?: string; url: string }
  | { kind: "local"; package: string; runtime: "node" | "python" };

/**
 * Where a keyed surface's key rides, as the --auth the command takes, or
 * undefined when the surface has no key to ride at all.
 *
 * The directory's own words ("api_key", "pat") say only that a key exists, and
 * a bearer header is what most of them mean, so those keep the default. An
 * entry that names the placement outright carries it through instead, which is
 * the difference between a set-up line that connects and one that spends the
 * conversation on 401s.
 */
function catalogKeyPlacement(auth: string | undefined): string | undefined {
  if (auth === undefined) {
    return undefined;
  }
  if (["api_key", "pat", "token"].includes(auth)) {
    return "bearer";
  }
  try {
    return parseAuth(auth, "api").kind === "none" ? undefined : auth;
  } catch {
    return undefined;
  }
}

/**
 * How a service is reached, decided once so the index and the detail cannot
 * disagree about it. An API a key opens is the third way in; a service with
 * none of the three (every way in wants a sign-in client of the user's own,
 * which the card cannot make) is set up as a web app at its home, rather than
 * handed a set-up line of placeholders that no --auth the command takes can
 * fill.
 */
export function catalogWayIn(entry: AppCatalogEntry): CatalogWayIn {
  const mcp = catalogEntryMcpEndpoint(entry);
  const mcpSurface = entry.interfaces.find(
    (candidate) => candidate.endpoint === mcp,
  );
  // A server that wants no sign-in, or a key rather than one, says so,
  // since an MCP app defaults to a sign-in card.
  const placement =
    mcpSurface?.auth === "none"
      ? "none"
      : catalogKeyPlacement(mcpSurface?.auth);
  const isKey =
    placement === "bearer" || placement?.startsWith("header:") === true;
  if (mcp && !isKey) {
    return placement === "none"
      ? { auth: placement, endpoint: mcp, kind: "mcp" }
      : { endpoint: mcp, kind: "mcp" };
  }
  // A server that wants a key is a way in only when the directory knows
  // where the user makes one; otherwise the next way in is tried.
  if (mcp && placement !== undefined && mcpSurface?.keyPage !== undefined) {
    return { auth: placement, endpoint: mcp, kind: "mcp" };
  }
  const local = catalogEntryLocalServer(entry);
  if (local) {
    return { kind: "local", ...local };
  }
  for (const surface of entry.interfaces) {
    if (
      surface.format === "mcp" ||
      surface.endpoint === undefined ||
      surface.keyPage === undefined
    ) {
      continue;
    }
    const auth = catalogKeyPlacement(surface.auth);
    if (auth !== undefined) {
      return {
        auth,
        endpoint: surface.endpoint,
        kind: "api",
        test: entry.apiGuide?.test,
      };
    }
  }
  const macApp = catalogEntryMacApp(entry);
  if (macApp) {
    return { bundleId: macApp.bundleId, kind: "mac-app", name: macApp.name };
  }
  return {
    kind: "web",
    url: entry.home ?? `https://${entry.domain}`,
    ...(entry.signIn ? { signIn: entry.signIn } : {}),
  };
}

/**
 * The --auth an app takes, as its manifest's auth binding: what each kind
 * of app accepts, with the default it falls back to and the words that say
 * what went wrong.
 */
export function parseAuth(
  raw: string | undefined,
  type: "api" | "mcp" | "mcp-local",
): CalledAppManifest["auth"] {
  const value =
    raw?.trim() ||
    (type === "mcp" ? "oauth" : type === "mcp-local" ? "none" : "bearer");
  if (type === "mcp-local") {
    if (value === "none") {
      return { kind: "none" };
    }
    const env = /^env:(.+)$/.exec(value);
    if (env?.[1]) {
      return { envVar: env[1].trim(), kind: "env" };
    }
    throw new Error(
      `a local server takes none, or env:<VAR> when it reads a key from its environment (got "${value}").`,
    );
  }
  if (value === "oauth") {
    if (type === "api") {
      throw new Error(
        "oauth is for MCP apps. An API app takes bearer, basic, basic:<user>, header:<Name>, query:<param>, or none.",
      );
    }
    return { kind: "oauth" };
  }
  if (value === "bearer" || value === "none") {
    return { kind: value };
  }
  const basic = /^basic(?::(.+))?$/.exec(value);
  if (basic) {
    if (type === "mcp") {
      throw new Error(
        "basic is for API apps. An MCP app takes oauth, bearer, header:<Name>, or none.",
      );
    }
    const user = basic[1]?.trim();
    return user ? { kind: "basic", user } : { kind: "basic" };
  }
  const header = /^header:(.+)$/.exec(value);
  if (header?.[1]) {
    return { header: header[1].trim(), kind: "header" };
  }
  const query = /^query:(.+)$/.exec(value);
  if (query?.[1]) {
    if (type === "mcp") {
      throw new Error("an MCP app cannot take its key in the query string.");
    }
    return { kind: "query", param: query[1].trim() };
  }
  throw new Error(
    `--auth takes ${
      type === "mcp"
        ? "oauth, bearer, header:<Name>, or none"
        : "bearer, basic, basic:<user>, header:<Name>, query:<param>, or none"
    } (got "${value}").`,
  );
}
