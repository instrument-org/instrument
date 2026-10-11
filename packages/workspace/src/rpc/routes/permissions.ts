import os from "node:os";
import { eventIterator, ORPCError } from "@orpc/server";
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
import {
  appBundleId,
  appReach,
  grantApp,
  reachesEveryFile,
} from "../../lib/permissions/apps";
import { closeAsk, openAsks } from "../../lib/permissions/asks";
import { chatRules } from "../../lib/permissions/chat-rules";
import { grantFolder } from "../../lib/chat/grants";
import { setDenied } from "../../lib/permissions/denials";
import { wakeSessionForPermission } from "../../lib/chat/wake";
import { recordChanges } from "../../lib/record-changes";
import { PermissionAskSchema } from "../../schemas/chat-state";
import { distinct, liveRead } from "../live-read";
import { reachOf } from "../../lib/permissions/rules";
import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { base } from "../base";

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
  withoutAsking: z.boolean(),
});

function view(
  settings: PermissionSettings,
): z.output<typeof PermissionsViewSchema> {
  const home = os.homedir();
  return {
    apps: settings.apps,
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

/**
 * What the rules make of a folder for one chat, so a card can tell a folder
 * the person already closed from one they have not been asked about.
 */
const reach = base
  .input(z.object({ id: ChatIdSchema, path: z.string() }))
  .output(z.object({ level: z.enum(["allow", "ask", "hidden", "never"]) }))
  .handler(async ({ input }) => {
    const rules = await chatRules({ chatId: input.id });
    return { level: reachOf(rules, input.path, "read").level };
  });

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
 * Lets a chat control an app: what answering its card does. "Always" also
 * allows the app in Settings › Permissions, for every chat from then on.
 */
const allowApp = base
  .input(
    z.object({
      always: z.boolean().optional(),
      app: z.string().trim().min(1),
      id: ChatIdSchema,
    }),
  )
  .output(z.void())
  .handler(async ({ input }) => {
    await grantApp(input.id, input.app);
    await setDenied(input.id, "app", input.app, false);
    if (input.always) {
      const bundleId = await appBundleId(input.app);
      await updatePermissionSettings((settings) => ({
        ...settings,
        apps: [
          ...settings.apps.filter(
            (app) => app.name.toLowerCase() !== input.app.toLowerCase(),
          ),
          {
            addedAt: getCurrentDate(),
            bundleId,
            level: "allow",
            name: input.app,
          },
        ],
      }));
    }
  });

/** What the rules make of an app for one chat, for its card. */
const appReachRoute = base
  .input(z.object({ app: z.string(), id: ChatIdSchema }))
  .output(z.object({ level: LevelSchema, reachesEveryFile: z.boolean() }))
  .handler(async ({ input }) => ({
    level: await appReach(input.id, input.app),
    reachesEveryFile: reachesEveryFile(input.app),
  }));

/** The chat's open asks, as its cards draw them, oldest first. */
const asks = base
  .input(z.object({ id: ChatIdSchema }))
  .output(PermissionAskSchema.array())
  .handler(({ input }) => openAsks(input.id));

/** The same asks, read again whenever the chat's state moves. */
const liveAsks = base
  .input(z.object({ id: ChatIdSchema }))
  .output(eventIterator(PermissionAskSchema.array()))
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

/**
 * The person's answer to an ask: allowed in this chat, allowed always, or
 * not now. A folder may be answered with a different one picked in the
 * system's panel. The session that asked is woken with the answer, or hears
 * it at its next step if its turn is still going.
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
          await updatePermissionSettings((settings) => ({
            ...settings,
            folders: [
              ...settings.folders.filter((known) => known.path !== folder),
              { addedAt: getCurrentDate(), level: "allow", path: folder },
            ],
          }));
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
    await wakeSessionForPermission(
      {
        data: { answer: input.decision, kind: ask.kind, target },
        type: "data-permissionAnswer",
      },
      context.workspaceRef,
      input.id,
      ask.sessionId,
    );
  });

export const permissions = {
  allowApp,
  answer,
  asks,
  liveAsks,
  appReach: appReachRoute,
  get,
  removeApp,
  setApp,
  reach,
  removeFolder,
  setFolder,
  setPlace,
  setWithoutAsking,
};
