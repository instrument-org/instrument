import os from "node:os";
import { ORPCError } from "@orpc/server";
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
  resetPermissionSettings,
  updatePermissionSettings,
} from "../../lib/permissions/rules";
import { appBundleId, grantApp } from "../../lib/permissions/apps";
import {
  closeAsk,
  type MacosAskStatus,
  setMacosStatus,
} from "../../lib/chat/asks";
import { openAsks } from "../../lib/chat/open-asks";
import {
  lookAsTheApp,
  macAppStanding,
  macosRefusalStatus,
  macosRefusedFolders,
  watchMacosPrompt,
} from "../../lib/permissions/macos";
import { allowThroughProtection } from "../../lib/permissions/windows-protection";
import { grantFolder } from "../../lib/chat/grants";
import { setDenied } from "../../lib/permissions/denials";
import { wakeAskers } from "../../lib/chat/wake";
import { askWindow } from "../../lib/chat/window-tab";
import { updateHeldTabs } from "../../lib/held-tabs";
import { parseBrowserTargetId } from "../../types";
import { hostPathWithin } from "../../lib/host-path";
import { ChatIdSchema } from "../../schemas/chat-id";
import { type AbsolutePath, AbsolutePathSchema } from "../../schemas/paths";
import { base } from "../base";
import { type PermissionAsk } from "../../schemas/chat-state";
import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceActorRef } from "../../machines/workspace";

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
      "did-not-start",
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
  /**
   * Whether every rule is still a new install's, in Settings and in every
   * chat and topic, so there is nothing for a reset to undo.
   */
  untouched: z.boolean(),
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
    untouched:
      settings.apps.length === 0 &&
      settings.folders.length === 0 &&
      Object.keys(settings.chats).length === 0 &&
      Object.keys(settings.topics).length === 0 &&
      !settings.dangerouslyAllowEveryFolder &&
      Object.entries(settings.places).every(
        ([id, level]) => level === PLACE_DEFAULTS[PlaceIdSchema.parse(id)],
      ),
  };
}

/** Settings › Permissions as the page draws it. */
const get = base
  .output(PermissionsViewSchema)
  .handler(async () => view(await readPermissionSettings()));

/**
 * What macOS keeps the app out of among what the person allowed, for
 * Settings to say beside their answer: each app it refuses, by name, as
 * macOS says now or last said, and each folder it guards that it last
 * refused, by that folder. Asking about a folder nobody answered would
 * raise macOS's prompt, so folders are what the app's own looks found.
 */
const macos = base
  .output(z.object({ apps: z.array(z.string()), folders: z.array(z.string()) }))
  .handler(async () => {
    if (process.platform !== "darwin") {
      return { apps: [], folders: [] };
    }
    const allowed = (await readPermissionSettings()).apps.filter(
      (app) => app.level === "allow",
    );
    const refused = await Promise.all(
      allowed.map(async (app) => {
        const bundleId = app.bundleId ?? (await appBundleId(app.name));
        return bundleId !== undefined &&
          (await macAppStanding({ bundleId, name: app.name })) === "denied"
          ? app.name
          : undefined;
      }),
    );
    return {
      apps: refused.filter((name) => name !== undefined),
      folders: macosRefusedFolders(),
    };
  });

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

/** Puts every rule back as a new install has it, in Settings and in every chat. */
const reset = base
  .output(PermissionsViewSchema)
  .handler(async () => view(await resetPermissionSettings()));

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
 * going. On macOS a folder or app allowed is asked of macOS first, which is
 * when the system's own prompt for it comes up, and the call settles once
 * that is answered; one the system refuses keeps its card, `macos-refused`,
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
    if (ask.kind === "tab") {
      await moveTabIn(input.id, ask, context.workspaceRef);
      return;
    }
    await grant(input.id, ask, input.decision);
    await settle(input.id, ask, input.decision, context.workspaceRef);
  });

/**
 * Asks macOS again about a folder or app it refused, after the person
 * picked the folder in the system's panel or allowed it in System Settings,
 * or waits out the prompt a card that is `macos-asking` stands for, and
 * wakes the askers with the yes they gave once the app gets in.
 */
const retry = base
  .input(z.object({ askId: z.string(), id: ChatIdSchema }))
  .output(z.void())
  .handler(async ({ context, input }) => {
    const ask = await openPermissionAsk(input.id, input.askId);
    if (
      (ask.status !== "macos-refused" &&
        ask.status !== "macos-asking" &&
        ask.status !== "windows-blocked") ||
      !ask.allowed
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "That request isn't waiting on the system.",
      });
    }
    await settle(input.id, ask, ask.allowed, context.workspaceRef);
  });

/**
 * Lets the programs Windows' ransomware protection blocked, and the app
 * itself, through it, behind Windows' own prompt for an administrator's
 * yes, then wakes the askers to try again. A prompt the person declines
 * leaves the card as it was.
 */
const allowThroughProtectionRoute = base
  .input(z.object({ askId: z.string(), id: ChatIdSchema }))
  .output(z.object({ outcome: z.enum(["allowed", "canceled", "failed"]) }))
  .handler(async ({ context, input }) => {
    const ask = await openPermissionAsk(input.id, input.askId);
    if (ask.status !== "windows-blocked" || process.platform !== "win32") {
      throw new ORPCError("BAD_REQUEST", {
        message: "That request isn't waiting on ransomware protection.",
      });
    }
    const outcome = await allowThroughProtection([
      ...new Set([...(ask.programs ?? []), process.execPath]),
    ]);
    if (outcome === "allowed") {
      await settle(
        input.id,
        ask,
        ask.allowed ?? "allowed",
        context.workspaceRef,
      );
    }
    return { outcome };
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
  // A tab kept is the person's to keep; asking again later is no worse for it.
  if (ask.kind !== "tab") {
    await setDenied(chatId, ask.kind, ask.target, true);
  }
  await wakeAskers(
    {
      data: {
        answer: "declined",
        kind: ask.kind,
        ...(ask.page && { page: ask.page }),
        target: ask.target,
      },
      type: "data-permissionAnswer",
    },
    workspaceRef,
    chatId,
    closed.askers.map((asker) => asker.sessionId),
  );
}

/**
 * Moves the tab a card asked for out of the person's own tabs and into the
 * chat, page and all, and wakes the askers. The first to ask drives it, as
 * a tab handed over: the person's, never closed by the agent. A tab closed
 * before the answer wakes them with that instead.
 */
async function moveTabIn(
  chatId: ChatId,
  ask: PermissionAsk,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const closed = await closeAsk(chatId, ask.id);
  if (!closed) {
    return;
  }
  const took = await askWindow({
    action: { kind: "take", tabId: ask.target },
    askedBy: chatId,
    group: chatId,
  });
  const tabId = parseBrowserTargetId(ask.target);
  const driver = closed.askers[0]?.sessionId;
  const moved =
    took !== undefined && took.error === undefined && tabId !== null;
  if (moved && driver !== undefined) {
    await updateHeldTabs(chatId, driver, (tabs) => [
      ...tabs.filter((tab) => tab.id !== tabId),
      { id: tabId, inWindow: true, openedBy: "handed" },
    ]);
  }
  await wakeAskers(
    {
      data: {
        answer: moved ? "allowed" : "gone",
        kind: "tab",
        ...(ask.page && { page: ask.page }),
        target: ask.target,
      },
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
  const { kind, target } = ask;
  // A tab is moved, never granted (`moveTabIn`).
  if (kind === "tab") {
    return;
  }
  await setDenied(chatId, kind, target, false);
  if (kind === "folder") {
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
 * the folder or the app: asking waits as long as the system's own prompt is
 * up, and the card says macOS is asking meanwhile. One macOS refuses stays
 * open, keeping the yes. Off macOS nothing is asked.
 *
 * An asker whose own command waits on the folder (`waits`) is never woken:
 * the command carries on by itself once macOS answers, and wakes its
 * session when it ends. So a card a command raised goes quietly when its
 * look gets in, whatever was on screen meanwhile.
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
    const kept = await macosKeepsOut(ask, () =>
      setMacosStatus(chatId, ask.id, "macos-asking", decision),
    );
    if (kept !== undefined) {
      await setMacosStatus(chatId, ask.id, kept, decision);
      return;
    }
    const closed = await closeAsk(chatId, ask.id);
    const woken = closed?.askers.filter((asker) => asker.waits !== true);
    if (!woken?.length) {
      return;
    }
    await wakeAskers(
      {
        data: {
          answer: decision,
          kind: ask.kind,
          target: ask.target,
          ...(ask.status === "windows-blocked" && {
            through: "windows-protection" as const,
          }),
        },
        type: "data-permissionAnswer",
      },
      workspaceRef,
      chatId,
      woken.map((asker) => asker.sessionId),
    );
  })().finally(() => {
    settling.delete(ask.id);
  });
  settling.set(ask.id, settled);
  return settled;
}

/**
 * How macOS keeps the app from what `ask` is for, once the person said
 * yes: the card's status, or undefined when it lets the app in (or off
 * macOS). A folder is looked inside, and an app asked of macOS, which raises
 * the system's prompt nobody has answered yet; `onAsking` runs once when
 * that prompt is on screen while the answer waits.
 */
async function macosKeepsOut(
  ask: PermissionAsk,
  onAsking: () => Promise<void>,
): Promise<Exclude<MacosAskStatus, "macos-asking"> | undefined> {
  if (process.platform !== "darwin") {
    return undefined;
  }
  if (ask.kind === "folder") {
    return (await lookAsTheApp(ask.target, onAsking)) === "system"
      ? macosRefusalStatus(ask.target)
      : undefined;
  }
  const bundleId = await appBundleId(ask.target);
  if (bundleId === undefined) {
    return undefined;
  }
  const standing = macAppStanding(
    { bundleId, name: ask.target },
    { request: true },
  );
  const watched = watchMacosPrompt(standing, onAsking);
  const standingAnswer = await standing;
  await watched;
  return standingAnswer === "denied" ? "macos-refused" : undefined;
}

export const permissions = {
  allowThroughProtection: allowThroughProtectionRoute,
  answer,
  declineAll,
  macos,
  retry,
  get,
  removeApp,
  reset,
  setApp,
  removeFolder,
  setFolder,
  setPlace,
  setDangerouslyAllowEveryFolder,
};
