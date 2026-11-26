import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceBrowserDir } from "@/electron-main/lib/get-workspace-folder";
import { storeJson } from "@/electron-main/stores/store-json";
import Store from "@/electron-main/stores/store";
import { z } from "zod";

const AccessSchema = z.object({
  origins: z.array(z.string()).catch([]),
  permissions: z.array(z.string()).catch([]),
});

/** What a person lets an extension reach, as a manifest names it. */
export type ExtensionAccess = z.output<typeof AccessSchema>;

const NONE: ExtensionAccess = { origins: [], permissions: [] };

const ExtensionRecordSchema = z.object({
  /** The person turned it off. */
  disabled: z.boolean().catch(false),
  /** What its worker has not been told yet of its install or update. */
  installed: z
    .object({
      previousVersion: z.string().optional(),
      reason: z.enum(["install", "update"]),
    })
    .nullable()
    .catch(null),
  /** What it was granted when it asked while running (`chrome.permissions.request`). */
  optional: AccessSchema.catch(NONE),
  /** What its manifest may ask for: what the person agreed to as it was added, and since. */
  required: AccessSchema.catch(NONE),
  /** The version that last ran. */
  version: z.string().nullable().catch(null),
});

export type ExtensionRecord = z.output<typeof ExtensionRecordSchema>;

const BrowserExtensionsStoreSchema = z.object({
  extensions: z.record(z.string(), ExtensionRecordSchema).catch({}),
});
type BrowserExtensionsStore = z.output<typeof BrowserExtensionsStoreSchema>;

let STORE: null | Store<BrowserExtensionsStore> = null;

/** What a person settled about each of the in-app browser's extensions, by its id. */
const getStore = (): Store<BrowserExtensionsStore> => {
  if (STORE === null) {
    const defaults = BrowserExtensionsStoreSchema.parse({});
    STORE = new Store<BrowserExtensionsStore>({
      cwd: workspaceBrowserDir(),
      defaults,
      deserialize: (value) => {
        const parsed = BrowserExtensionsStoreSchema.safeParse(storeJson(value));
        if (parsed.success) {
          return parsed.data;
        }
        logger.error("Failed to parse the browser's extensions", parsed.error);
        return defaults;
      },
      name: "browser-extensions",
    });
  }
  return STORE;
};

export function extensionRecord(id: string): ExtensionRecord | undefined {
  return getStore().get("extensions")[id];
}

/** Changes what is kept of an extension, starting a record for one with none. */
export function updateExtensionRecord(
  id: string,
  change: Partial<ExtensionRecord>,
): void {
  const store = getStore();
  const extensions = store.get("extensions");
  store.set("extensions", {
    ...extensions,
    [id]: {
      ...(extensions[id] ?? ExtensionRecordSchema.parse({})),
      ...change,
    },
  });
}

export function forgetExtensionRecord(id: string): void {
  const store = getStore();
  const { [id]: _forgotten, ...rest } = store.get("extensions");
  store.set("extensions", rest);
}
