import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceKeysDir } from "@/electron-main/lib/get-workspace-folder";
import {
  KEY_FILE_EXTENSION,
  KEY_STORE_NAMES,
  keyFileDeserializer,
  keyFileSerializer,
  requireSavableKeys,
} from "@/electron-main/lib/key-file";
import { type StoredAppKey } from "@instrument-org/workspace/electron";
import Store from "@/electron-main/stores/store";
import { z } from "zod";

// An app's keys, each a record of its own with the origin it was saved for:
// the workspace sends it nowhere else. An app's one key is under its slug;
// one of several is under the slug, a slash, and the label its setup gives
// it, which no slug holds. Values only ever leave this store through the
// workspace config's `getCredentials` at request time; the RPC layer exposes
// presence, the date and a long key's last four characters, never values. A
// file whose entries carry no origin fails the parse and reads as empty, so
// those apps ask for a key again.
const AppCredentialsStoreSchema = z
  .object({
    credentials: z
      .record(
        z.string(),
        z.object({
          origin: z.string().min(1),
          savedAt: z.number().optional(),
          value: z.string(),
        }),
      )
      .default({}),
  })
  .default({ credentials: {} });

type AppCredentialsStore = z.output<typeof AppCredentialsStoreSchema>;

const FILE = { dir: workspaceKeysDir, name: KEY_STORE_NAMES.appCredentials };

let APP_CREDENTIALS_STORE: null | Store<AppCredentialsStore> = null;

const getAppCredentialsStore = (): Store<AppCredentialsStore> => {
  if (!APP_CREDENTIALS_STORE) {
    const defaultStore: AppCredentialsStore = { credentials: {} };

    APP_CREDENTIALS_STORE = new Store<AppCredentialsStore>({
      cwd: workspaceKeysDir(),
      defaults: defaultStore,
      deserialize: keyFileDeserializer({
        fallback: () => ({ credentials: {} }),
        log: logger,
        lost: "the keys saved for apps",
        name: "the app credential store",
        parse: (json) => AppCredentialsStoreSchema.parse(json),
      }),
      fileExtension: KEY_FILE_EXTENSION,
      name: KEY_STORE_NAMES.appCredentials,
      serialize: keyFileSerializer({
        dir: workspaceKeysDir,
        log: logger,
        name: KEY_STORE_NAMES.appCredentials,
      }),
    });
  }

  return APP_CREDENTIALS_STORE;
};

const recordOf = (slug: string, label: string | undefined) =>
  label === undefined ? slug : `${slug}/${label}`;

const isOf = (slug: string, record: string) =>
  record === slug || record.startsWith(`${slug}/`);

export function getAppCredentials(slug: string): StoredAppKey[] {
  return Object.entries(getAppCredentialsStore().get("credentials")).flatMap(
    ([record, stored]) =>
      isOf(slug, record)
        ? [
            {
              ...stored,
              ...(record === slug
                ? {}
                : { label: record.slice(slug.length + 1) }),
            },
          ]
        : [],
  );
}

export function removeAppCredentials(slug: string): void {
  requireSavableKeys({ ...FILE, removes: true });
  const store = getAppCredentialsStore();
  store.set(
    "credentials",
    Object.fromEntries(
      Object.entries(store.get("credentials")).filter(
        ([record]) => !isOf(slug, record),
      ),
    ),
  );
}

/** Keeps the keys given, beside whatever others the app has. */
export function setAppCredentials(slug: string, keys: StoredAppKey[]): void {
  requireSavableKeys(FILE);
  const store = getAppCredentialsStore();
  store.set("credentials", {
    ...store.get("credentials"),
    ...Object.fromEntries(
      keys.map(({ label, ...stored }) => [recordOf(slug, label), stored]),
    ),
  });
}
