import { z } from "zod";

import { getWorkspaceConfig } from "../workspace-config";

/**
 * What the Finder knows about one entry of a folder beyond what `stat` says.
 * Only an entry with something to say is named at all.
 */
export const FinderEntrySchema = z.object({
  /** A Finder alias, which is a file pointing elsewhere; a symbolic link is not one. */
  alias: z.literal(true).optional(),
  /** Hidden by the system, by a leading dot or by the flag `~/Library` carries. */
  hidden: z.literal(true).optional(),
  /** Whether the Finder leaves the extension off the name it shows. */
  hidesExtension: z.literal(true).optional(),
  /** A package's kind as the Finder writes it: "Application", "Photos Library". */
  kind: z.string().optional(),
  name: z.string(),
  /** A folder the Finder shows and opens as one item: an app, a Photos library. */
  package: z.literal(true).optional(),
});
export type FinderEntry = z.output<typeof FinderEntrySchema>;

/**
 * The Finder's answers for a folder's entries, by name. Empty off macOS, in a
 * build without the Mac module, and when the module could not read the
 * folder: the listing then shows what `stat` says, as it does everywhere else.
 *
 * Keyed by the name's composed form, since a name on disk may be stored
 * decomposed and the two halves of the bridge need not agree on which.
 */
export async function finderEntriesOf(
  folder: string,
): Promise<ReadonlyMap<string, FinderEntry>> {
  const ask = getWorkspaceConfig().finderEntries;
  if (!ask) {
    return new Map();
  }
  const entries = await ask(folder).catch(() => []);
  return new Map(entries.map((entry) => [entry.name.normalize("NFC"), entry]));
}
