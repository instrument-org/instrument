import { applyServedAppCatalog } from "../../lib/apps/catalog";
import seed from "../../lib/apps/catalog-seed.json";

/**
 * Use the built-in directory with a sign-in client given to the interfaces
 * of one or more services that sign in with Instrument's own client (an MCP
 * server, or an API such as Microsoft Graph), as our API serves it to the
 * people a client is open to. Undo with `resetServedAppCatalog`.
 */
export function serveRegisteredClient(
  slug: string | string[],
  clientId: string,
): void {
  const slugs = [slug].flat();
  const served = {
    ...seed,
    entries: seed.entries.map((entry) =>
      slugs.includes(entry.slug)
        ? {
            ...entry,
            interfaces: entry.interfaces.map((surface) =>
              "auth" in surface && surface.auth === "oauth-client"
                ? { ...surface, clientId }
                : surface,
            ),
          }
        : entry,
    ),
  };
  if (applyServedAppCatalog(served) !== "used") {
    throw new Error("The served directory was refused");
  }
}
