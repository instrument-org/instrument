import { perWorkspace } from "@/electron-main/lib/workspace-scope";
import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceBrowserDir } from "@/electron-main/lib/get-workspace-folder";
import Store from "electron-store";
import { z } from "zod";

/**
 * A site a person told the in-app browser may always hand one kind of link
 * to another app: `https://app.slack.com` and `slack:`.
 */
const AllowedLinkSchema = z.object({
  origin: z.string(),
  scheme: z.string(),
});

const ExternalAppLinksSchema = z.object({
  allowed: z.array(AllowedLinkSchema).catch([]),
});

type ExternalAppLinks = z.output<typeof ExternalAppLinksSchema>;

/** Opened once for each workspace, in its scope (`perWorkspace`). */
const storeInScope = perWorkspace((): Store<ExternalAppLinks> => {
  const defaults = ExternalAppLinksSchema.parse({});
  const store = new Store<ExternalAppLinks>({
    cwd: workspaceBrowserDir(),
    defaults,
    deserialize: (value) => {
      const parsed = ExternalAppLinksSchema.safeParse(JSON.parse(value));
      if (parsed.success) {
        return parsed.data;
      }
      logger.error("Failed to parse external app links", parsed.error);
      return defaults;
    },
    name: "external-app-links",
  });
  return store;
});

/** The sites that open another app's links without asking first. */
export const getExternalAppLinksStore = (): Store<ExternalAppLinks> => {
  return storeInScope();
};
