import { applyServedAppCatalog } from "../../lib/apps/catalog";
import seed from "../../lib/apps/catalog-seed.json";

/**
 * Use the built-in directory with a sign-in client given to one service's
 * MCP server, as our API serves it to the people a client is open to. Undo
 * with `resetServedAppCatalog`.
 */
export function serveRegisteredClient(slug: string, clientId: string): void {
  const served = {
    ...seed,
    entries: seed.entries.map((entry) =>
      entry.slug === slug
        ? {
            ...entry,
            interfaces: entry.interfaces.map((surface) =>
              surface.format === "mcp" ? { ...surface, clientId } : surface,
            ),
          }
        : entry,
    ),
  };
  if (applyServedAppCatalog(served) !== "used") {
    throw new Error("The served directory was refused");
  }
}
