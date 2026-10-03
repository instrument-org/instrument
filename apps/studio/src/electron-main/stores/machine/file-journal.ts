import { logger } from "@/electron-main/lib/electron-logger";
import {
  createFileJournal,
  type FileJournal,
  JournalEntrySchema,
} from "@/electron-main/lib/file-journal";
import Store from "electron-store";
import { z } from "zod";

// What the Finder did to this computer's files, for ⌘Z. The paths are the
// machine's, so the journal is too: a second workspace on the same computer
// undoes the same renames.
const FileJournalStoreSchema = z.object({
  // One entry that no longer parses is dropped rather than taking the rest
  // with it.
  entries: z
    .array(z.unknown())
    .default([])
    .transform((entries) =>
      entries.flatMap((entry) => {
        const parsed = JournalEntrySchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

type FileJournalStore = z.output<typeof FileJournalStoreSchema>;

let JOURNAL: FileJournal | null = null;

export function getFileJournal(): FileJournal {
  if (JOURNAL === null) {
    const defaults = FileJournalStoreSchema.parse({});
    const store = new Store<FileJournalStore>({
      defaults,
      deserialize: (value) => {
        try {
          const parsed = FileJournalStoreSchema.safeParse(JSON.parse(value));
          if (parsed.success) {
            return parsed.data;
          }
          logger.error("Failed to parse the file journal", parsed.error);
        } catch (error) {
          logger.error("Failed to read the file journal", error);
        }
        return defaults;
      },
      name: "file-journal",
    });
    JOURNAL = createFileJournal({
      read: () => store.get("entries"),
      write: (entries) => {
        store.set("entries", entries);
      },
    });
  }
  return JOURNAL;
}
