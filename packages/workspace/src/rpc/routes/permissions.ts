import os from "node:os";
import { eventIterator, ORPCError } from "@orpc/server";
import { z } from "zod";

import { getCurrentDate } from "../../lib/get-current-date";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { homeDataLayout, workspaceLayout } from "../../lib/workspace-layout";
import { nativeSandboxOff, type SandboxOff } from "../../lib/native-sandbox";
import {
  type Level,
  LevelSchema,
  PLACE_DEFAULTS,
  PlaceIdSchema,
  placePaths,
  windowsProgramFolders,
} from "../../lib/permissions/places";
import {
  type PermissionSettings,
  readPermissionSettings,
  updatePermissionSettings,
} from "../../lib/permissions/rules";
import { appBundleId, grantApp } from "../../lib/permissions/apps";
import { closeAsk, openAsks, refusedByMacos } from "../../lib/chat/asks";
import { grantFolder } from "../../lib/chat/grants";
import { setDenied } from "../../lib/permissions/denials";
import { wakeAskers } from "../../lib/chat/wake";
import { hostPathWithin } from "../../lib/host-path";
import { ChatIdSchema } from "../../schemas/chat-id";
import { type AbsolutePath, AbsolutePathSchema } from "../../schemas/paths";
import { base } from "../base";
import { recordChanges } from "../../lib/record-changes";
import { AskSchema, type PermissionAsk } from "../../schemas/chat-state";
import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { listFolder } from "../../lib/chat/folder-look";
import { distinct, liveRead } from "../live-read";

const PermissionsViewSchema = z.object({
  /**
   * What every chat reaches whatever the list says, because the app needs
   * it (`layoutRules`), and the caches the app-files place opens unless it
   * is Not allowed.
   */
  alwaysOpen: z.object({
    caches: z.array(z.string()),
    /** Every chat's records, read-only. */
    chats: z.string(),
    /** Program folders every chat reads, on Windows. */
    programs: z.array(z.string()),
    /** Every chat's work folder, in every workspace. */
    workFolders: z.string(),
  }),
  apps: z.array(
    z.object({ addedAt: z.date(), level: LevelSchema, name: z.string() }),
  ),
  /**
   * Why the programs the agent runs are not held to the list by the system,
   * which Settings says plainly; absent where they are.
   */
  sandboxOff: z
    .enum([
      "no-bubblewrap",
      "no-seatbelt",
      "user-namespaces-closed",
      "windows",
    ] satisfies SandboxOff[])
    .optional(),
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
  const places = placePaths(home);
  return {
    alwaysOpen: {
      caches:
        places.find((place) => place.id === "appFiles")?.openUnlessClosed ?? [],
      chats: workspaceLayout(getWorkspaceConfig().rootDir).chatsDir,
      programs: process.platform === "win32" ? windowsProgramFolders(home) : [],
      workFolders: homeDataLayout(home).workDir,
    },
    apps: settings.apps,
    sandboxOff: nativeSandboxOff(),
    folders: settings.folders,
    home,
    places: places.map((place) => ({
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
 * not now, which the chat keeps whoever asked. Every session that asked is
 * woken with the answer, or hears it at its next step if its turn is still
 * going. On macOS a folder allowed is looked inside first, which is when the
 * system's own ask for it comes up, and the call settles once that is
 * answered; a folder the system refuses keeps its card, `macos-refused`,
 * until `retry` gets in or the person declines.
 */
const answer = base
  .input(
    z.object({
      askId: z.string(),
      decision: z.enum(["allowed", "always", "declined"]),
      id: ChatIdSchema,
    }),
  )
  .output(z.void())
  .handler(async ({ context, input }) => {
    const ask = await openPermissionAsk(input.id, input.askId);
    if (input.decision === "declined") {
      await decline(input.id, ask, context.workspaceRef);
      return;
    }
    await grant(input.id, ask, input.decision);
    await settle(input.id, ask, input.decision, context.workspaceRef);
  });

/**
 * Looks inside a folder macOS refused again, after the person picked it in
 * the system's folder panel or allowed it in System Settings, and wakes the
 * askers with the yes they gave once it gets in.
 */
const retry = base
  .input(z.object({ askId: z.string(), id: ChatIdSchema }))
  .output(z.void())
  .handler(async ({ context, input }) => {
    const ask = await openPermissionAsk(input.id, input.askId);
    if (ask.status !== "macos-refused" || !ask.allowed) {
      throw new ORPCError("BAD_REQUEST", {
        message: "That request isn't waiting on macOS.",
      });
    }
    await settle(input.id, ask, ask.allowed, context.workspaceRef);
  });

/** Says not now to every permission card the chat has open. */
const declineAll = base
  .input(z.object({ id: ChatIdSchema }))
  .output(z.void())
  .handler(async ({ context, input }) => {
    const asks = (await openAsks(input.id)).filter(
      (ask): ask is PermissionAsk => ask.kind !== "question",
    );
    await Promise.all(
      asks.map((ask) => decline(input.id, ask, context.workspaceRef)),
    );
  });

async function openPermissionAsk(
  chatId: ChatId,
  askId: string,
): Promise<PermissionAsk> {
  const ask = (await openAsks(chatId)).find(
    (open): open is PermissionAsk =>
      open.id === askId && open.kind !== "question",
  );
  if (!ask) {
    throw new ORPCError("NOT_FOUND", {
      message: "That request was already answered.",
    });
  }
  return ask;
}

async function decline(
  chatId: ChatId,
  ask: PermissionAsk,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  // A check still looking inside finds the card gone and wakes nobody.
  const closed = await closeAsk(chatId, ask.id);
  if (!closed) {
    return;
  }
  await setDenied(chatId, ask.kind, ask.target, true);
  await wakeAskers(
    {
      data: { answer: "declined", kind: ask.kind, target: ask.target },
      type: "data-permissionAnswer",
    },
    workspaceRef,
    chatId,
    closed.askers.map((asker) => asker.sessionId),
  );
}

/** Lets the chat use what the ask is for, and every chat with Always allow. */
async function grant(
  chatId: ChatId,
  ask: PermissionAsk,
  decision: "allowed" | "always",
): Promise<void> {
  const { target } = ask;
  await setDenied(chatId, ask.kind, target, false);
  if (ask.kind === "folder") {
    await grantFolder({ chatId, path: target, source: "card" });
    if (decision === "always") {
      const folder = AbsolutePathSchema.parse(target);
      await updatePermissionSettings((settings) =>
        withFolderLevel(settings, folder, "allow"),
      );
    }
    return;
  }
  await grantApp(chatId, target);
  if (decision === "always") {
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

/** The look inside running for each ask, so an Allow from another window joins it. */
const settling = new Map<string, Promise<void>>();

/**
 * Closes an allowed ask and wakes its askers, once macOS lets the app into
 * the folder: the look inside waits as long as the system's own ask is up.
 * One macOS refuses stays open as `macos-refused`, keeping the yes. Off
 * macOS, and for an app, nothing is looked at.
 */
function settle(
  chatId: ChatId,
  ask: PermissionAsk,
  decision: "allowed" | "always",
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const running = settling.get(ask.id);
  if (running) {
    return running;
  }
  const settled = (async () => {
    if (ask.kind === "folder" && process.platform === "darwin") {
      if ((await listFolder(ask.target)) === "system") {
        await refusedByMacos(chatId, ask.id, decision);
        return;
      }
    }
    const closed = await closeAsk(chatId, ask.id);
    if (!closed) {
      return;
    }
    await wakeAskers(
      {
        data: { answer: decision, kind: ask.kind, target: ask.target },
        type: "data-permissionAnswer",
      },
      workspaceRef,
      chatId,
      closed.askers.map((asker) => asker.sessionId),
    );
  })().finally(() => {
    settling.delete(ask.id);
  });
  settling.set(ask.id, settled);
  return settled;
}

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
  declineAll,
  retry,
  liveAsks,
  get,
  removeApp,
  setApp,
  removeFolder,
  setFolder,
  setPlace,
  setDangerouslyAllowEveryFolder,
};
