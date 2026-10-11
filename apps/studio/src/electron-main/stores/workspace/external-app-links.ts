import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceSettingsDir } from "@/electron-main/lib/get-workspace-folder";
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

let STORE: null | Store<ExternalAppLinks> = null;

/** The sites that open another app's links without asking first. */
export const getExternalAppLinksStore = (): Store<ExternalAppLinks> => {
  if (STORE === null) {
    const defaults = ExternalAppLinksSchema.parse({});
    STORE = new Store<ExternalAppLinks>({
      cwd: workspaceSettingsDir(),
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
  }
  return STORE;
};
