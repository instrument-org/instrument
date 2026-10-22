import { generateModelName } from "./generate-model-name";

/**
 * What the app calls a model wherever it names one: the name its catalog
 * record gave, or one derived from the id when no record was kept. That is
 * ordinary for a model an alias or a router resolved to, one released after
 * the catalog was read, and one no longer offered, and an id like
 * `anthropic/claude-haiku-5.5` reads as code where a name belongs.
 *
 * The maker's prefix is dropped before deriving, since the provider's mark
 * beside the name already says it. Trimmed, because the gateway's names can
 * arrive with a leading space.
 */
export function modelDisplayName(id: string, name?: string): string {
  const named = name?.trim();
  if (named) {
    return named;
  }
  const bare = id.split("/").at(-1);
  return bare ? generateModelName(bare) : id;
}
