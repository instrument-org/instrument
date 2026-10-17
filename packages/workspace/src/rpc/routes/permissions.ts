import os from "node:os";
import { eventIterator, ORPCError } from "@orpc/server";
import { z } from "zod";

import { getCurrentDate } from "../../lib/get-current-date";
import { nativeSandboxEnforced } from "../../lib/native-sandbox";
import {
  type Level,
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
import { appBundleId, grantApp } from "../../lib/permissions/apps";
import { closeAsk, openAsks } from "../../lib/chat/asks";
import { grantFolder } from "../../lib/chat/grants";
import { setDenied } from "../../lib/permissions/denials";
import { wakeAskers } from "../../lib/chat/wake";
import { hostPathWithin } from "../../lib/host-path";
import { ChatIdSchema } from "../../schemas/chat-id";
import { type AbsolutePath, AbsolutePathSchema } from "../../schemas/paths";
import { base } from "../base";
import { recordChanges } from "../../lib/record-changes";
import { AskSchema } from "../../schemas/chat-state";
import { distinct, liveRead } from "../live-read";

const PermissionsViewSchema = z.object({
  apps: z.array(
    z.object({ addedAt: z.date(), level: LevelSchema, name: z.string() }),
  ),
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
  dangerouslyAllowEveryFolder: z.boolean(),
});

function view(
  settings: PermissionSettings,
): z.output<typeof PermissionsViewSchema> {
  const home = os.homedir();
  return {
    apps: settings.apps,
    enforced: nativeSandboxEnforced(),
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
    dangerouslyAllowEveryFolder: settings.dangerouslyAllowEveryFolder,
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

/**
 * Settings with a folder set to `level`. A folder that is a built-in place
 * on its own (Documents, Desktop, Downloads) changes that place instead, so
 * the list never shows one folder twice with two answers. A place made of
 * several folders, or one that also holds the home folder's hidden entries,
 * keeps a rule for the one folder, which opens no more than was asked.
 */
function withFolderLevel(
  settings: PermissionSettings,
  folder: AbsolutePath,
  level: Level,
): PermissionSettings {
  for (const place of placePaths()) {
    const [only, ...others] = place.paths;
    if (
      place.id !== "output" &&
      only !== undefined &&
      others.length === 0 &&
      !place.closedUnlessAllowed &&
      hostPathWithin(only, folder) === "/"
    ) {
      return {
        ...settings,
        folders: settings.folders.filter((f) => f.path !== folder),
        places: { ...settings.places, [place.id]: level },
      };
    }
  }
  const known = settings.folders.find((f) => f.path === folder);
  return {
    ...settings,
    folders: known
      ? settings.folders.map((f) => (f.path === folder ? { ...f, level } : f))
      : [
          ...settings.folders,
          { addedAt: getCurrentDate(), level, path: folder },
        ],
  };
}

/** Adds or changes a folder's own rule. */
const setFolder = base
  .input(z.object({ level: LevelSchema, path: AbsolutePathSchema }))
  .output(PermissionsViewSchema)
  .handler(async ({ input }) =>
    view(
      await updatePermissionSettings((settings) =>
        withFolderLevel(settings, input.path, input.level),
      ),
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
const setDangerouslyAllowEveryFolder = base
  .input(z.object({ dangerouslyAllowEveryFolder: z.boolean() }))
  .output(PermissionsViewSchema)
  .handler(async ({ input }) =>
    view(
      await updatePermissionSettings((settings) => ({
        ...settings,
        dangerouslyAllowEveryFolder: input.dangerouslyAllowEveryFolder,
      })),
    ),
  );

/** Adds or changes an app's own rule. */
const setApp = base
  .input(z.object({ level: LevelSchema, name: z.string().trim().min(1) }))
  .output(PermissionsViewSchema)
  .handler(async ({ input }) =>
    view(
      await updatePermissionSettings((settings) => {
        const others = settings.apps.filter(
          (app) => app.name.toLowerCase() !== input.name.toLowerCase(),
        );
        const known = settings.apps.find(
          (app) => app.name.toLowerCase() === input.name.toLowerCase(),
        );
        return {
          ...settings,
          apps: [
            ...others,
            {
              addedAt: known?.addedAt ?? getCurrentDate(),
              level: input.level,
              name: known?.name ?? input.name,
            },
          ],
        };
      }),
    ),
  );

/** Removes an app's rule, so the agent asks about it again. */
const removeApp = base
  .input(z.object({ name: z.string() }))
  .output(PermissionsViewSchema)
  .handler(async ({ input }) =>
    view(
      await updatePermissionSettings((settings) => ({
        ...settings,
        apps: settings.apps.filter(
          (app) => app.name.toLowerCase() !== input.name.toLowerCase(),
        ),
      })),
    ),
  );

/**
 * The person's answer to an ask: allowed in this chat, allowed always, or
 * not now, which the chat keeps whoever asked. A folder may be answered with
 * a different one picked in the system's panel. Every session that asked is
 * woken with the answer, or hears it at its next step if its turn is still
 * going.
 */
const answer = base
  .input(
    z.object({
      askId: z.string(),
      decision: z.enum(["allowed", "always", "declined"]),
      id: ChatIdSchema,
      /** A folder picked in place of the one asked for. */
      path: z.string().optional(),
    }),
  )
  .output(z.void())
  .handler(async ({ context, input }) => {
    const ask = await closeAsk(input.id, input.askId);
    if (!ask) {
      throw new ORPCError("NOT_FOUND", {
        message: "That request was already answered.",
      });
    }
    const target =
      ask.kind === "folder" ? (input.path ?? ask.target) : ask.target;
    await setDenied(input.id, ask.kind, target, input.decision === "declined");
    if (input.decision !== "declined") {
      if (ask.kind === "folder") {
        await grantFolder({ chatId: input.id, path: target, source: "card" });
        if (input.decision === "always") {
          const folder = AbsolutePathSchema.parse(target);
          await updatePermissionSettings((settings) =>
            withFolderLevel(settings, folder, "allow"),
          );
        }
      } else {
        await grantApp(input.id, target);
        if (input.decision === "always") {
          const bundleId = await appBundleId(target);
          await updatePermissionSettings((settings) => ({
            ...settings,
            apps: [
              ...settings.apps.filter(
                (app) => app.name.toLowerCase() !== target.toLowerCase(),
              ),
              {
                addedAt: getCurrentDate(),
                bundleId,
                level: "allow",
                name: target,
              },
            ],
          }));
        }
      }
    }
    await wakeAskers(
      {
        data: { answer: input.decision, kind: ask.kind, target },
        type: "data-permissionAnswer",
      },
      context.workspaceRef,
      input.id,
      ask.askers.map((asker) => asker.sessionId),
    );
  });

/**
 * The chat's open asks, as its cards draw them, oldest first, read again
 * whenever the chat's state moves.
 */
const liveAsks = base
  .input(z.object({ id: ChatIdSchema }))
  .output(eventIterator(AskSchema.array()))
  .handler(async function* ({ input, signal }) {
    yield* distinct(
      liveRead({
        changes: [
          recordChanges(
            signal,
            (change) => change.id === input.id && change.kind === "state",
          ),
        ],
        read: () => openAsks(input.id),
      }),
    );
  });

export const permissions = {
  answer,
  liveAsks,
  get,
  removeApp,
  setApp,
  removeFolder,
  setFolder,
  setPlace,
  setDangerouslyAllowEveryFolder,
};
