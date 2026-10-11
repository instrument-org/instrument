import os from "node:os";
import { z } from "zod";

import { getCurrentDate } from "../../lib/get-current-date";
import { bwrapAvailable, seatbeltAvailable } from "../../lib/native-sandbox";
import {
  LevelSchema,
  PLACE_DEFAULTS,
  PlaceIdSchema,
  placePaths,
} from "../../lib/permissions/places";
import {
  type PermissionSettings,
  readPermissionSettings,
  updatePermissionSettings,
} from "../../lib/permissions/rules";
import { AbsolutePathSchema } from "../../schemas/paths";
import { base } from "../base";

const PermissionsViewSchema = z.object({
  /**
   * Whether the programs the agent runs are held to the list by the system,
   * which Settings says plainly where they are not.
   */
  enforced: z.boolean(),
  folders: z.array(
    z.object({ addedAt: z.date(), level: LevelSchema, path: z.string() }),
  ),
  home: z.string(),
  places: z.array(
    z.object({
      id: PlaceIdSchema,
      level: LevelSchema,
      paths: z.array(z.string()),
    }),
  ),
  withoutAsking: z.boolean(),
});

function view(
  settings: PermissionSettings,
): z.output<typeof PermissionsViewSchema> {
  const home = os.homedir();
  return {
    enforced: seatbeltAvailable() || bwrapAvailable(),
    folders: settings.folders,
    home,
    places: placePaths(home).map((place) => ({
      id: place.id,
      level:
        place.id === "output"
          ? PLACE_DEFAULTS.output
          : (settings.places[place.id] ?? PLACE_DEFAULTS[place.id]),
      paths: place.paths,
    })),
    withoutAsking: settings.withoutAsking,
  };
}

/** Settings › Permissions as the page draws it. */
const get = base
  .output(PermissionsViewSchema)
  .handler(async () => view(await readPermissionSettings()));

/** Sets a built-in place's rule. The output folder is always allowed. */
const setPlace = base
  .input(
    z.object({
      id: PlaceIdSchema.exclude(["output"]),
      level: LevelSchema,
    }),
  )
  .output(PermissionsViewSchema)
  .handler(async ({ input }) =>
    view(
      await updatePermissionSettings((settings) => ({
        ...settings,
        places: { ...settings.places, [input.id]: input.level },
      })),
    ),
  );

/** Adds or changes a folder's own rule. */
const setFolder = base
  .input(z.object({ level: LevelSchema, path: AbsolutePathSchema }))
  .output(PermissionsViewSchema)
  .handler(async ({ input }) =>
    view(
      await updatePermissionSettings((settings) => {
        const known = settings.folders.find((f) => f.path === input.path);
        return {
          ...settings,
          folders: known
            ? settings.folders.map((f) =>
                f.path === input.path ? { ...f, level: input.level } : f,
              )
            : [
                ...settings.folders,
                {
                  addedAt: getCurrentDate(),
                  level: input.level,
                  path: input.path,
                },
              ],
        };
      }),
    ),
  );

/** Removes a folder's rule, so it falls back to the rule around it. */
const removeFolder = base
  .input(z.object({ path: AbsolutePathSchema }))
  .output(PermissionsViewSchema)
  .handler(async ({ input }) =>
    view(
      await updatePermissionSettings((settings) => ({
        ...settings,
        folders: settings.folders.filter((f) => f.path !== input.path),
      })),
    ),
  );

/** "Use folders without asking": every Ask first becomes a yes. */
const setWithoutAsking = base
  .input(z.object({ withoutAsking: z.boolean() }))
  .output(PermissionsViewSchema)
  .handler(async ({ input }) =>
    view(
      await updatePermissionSettings((settings) => ({
        ...settings,
        withoutAsking: input.withoutAsking,
      })),
    ),
  );

export const permissions = {
  get,
  removeFolder,
  setFolder,
  setPlace,
  setWithoutAsking,
};
