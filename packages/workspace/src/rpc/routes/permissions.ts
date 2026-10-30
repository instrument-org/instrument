import os from "node:os";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { getCurrentDate } from "../../lib/get-current-date";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { homeDataLayout, workspaceLayout } from "../../lib/workspace-layout";
import { nativeSandboxOff, type SandboxOff } from "../../lib/native-sandbox";
import {
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
import { appBundleId } from "../../lib/permissions/apps";
import {
  answerableElsewhere,
  computerName,
  openCard,
  openCards,
  thisDevice,
} from "../../lib/chat/asks";
import {
  answerAsk,
  settle,
  withFolderLevel,
} from "../../lib/chat/card-answers";
import {
  macAppStanding,
  macosRefusedFolders,
} from "../../lib/permissions/macos";
import { allowThroughProtection } from "../../lib/permissions/windows-protection";
import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { base } from "../base";
import {
  CardDecisionSchema,
  type PermissionCard,
} from "../../schemas/permission-card";
import { type ChatId } from "../../schemas/chat-id";

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
 * The person's answer to a card, from any device the chat is open on:
 * allowed in this chat, allowed always, or not now, which the chat keeps
 * whoever asked. On the computer the card belongs to it is taken at once,
 * after any answer another device gave first, which wins; every session that
 * asked is woken with it, or hears it at its next step if its turn is still
 * going. On macOS a folder or app allowed is asked of macOS first, which is
 * when the system's own prompt for it comes up, and the call settles once
 * that is answered; one the system refuses keeps its card, `macos-refused`,
 * until `retry` gets in or the person declines. On any other device the
 * answer is recorded for that computer to take (`card-answers.ts`).
 */
const answer = base
  .input(
    z.object({
      askId: z.string(),
      decision: CardDecisionSchema,
      id: ChatIdSchema,
    }),
  )
  .output(z.void())
  .handler(async ({ context, input }) => {
    await answerAsk(
      input.id,
      input.askId,
      input.decision,
      context.workspaceRef,
    );
  });

/**
 * Asks macOS again about a folder or app it refused, after the person
 * picked the folder in the system's panel or allowed it in System Settings,
 * or waits out the prompt a card that is `macos-asking` stands for, and
 * wakes the askers with the yes they gave once the app gets in. Only the
 * computer the card belongs to can.
 */
const retry = base
  .input(z.object({ askId: z.string(), id: ChatIdSchema }))
  .output(z.void())
  .handler(async ({ context, input }) => {
    const ask = await ownOpenCard(input.id, input.askId);
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
    const ask = await ownOpenCard(input.id, input.askId);
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

/**
 * Says not now to every permission card the chat has open that this
 * device can answer: every one of this computer's, and another computer's
 * that need not be answered on its own screen.
 */
const declineAll = base
  .input(z.object({ id: ChatIdSchema }))
  .output(z.void())
  .handler(async ({ context, input }) => {
    const device = thisDevice();
    const asks = (await openCards(input.id)).filter(
      ({ answer: given, card }) =>
        card.device === device ||
        answerableElsewhere(card, given !== undefined),
    );
    await Promise.all(
      asks.map(({ card }) =>
        answerAsk(input.id, card.id, "declined", context.workspaceRef),
      ),
    );
  });

/** One of this computer's open cards, which only it can act on. */
async function ownOpenCard(
  chatId: ChatId,
  askId: string,
): Promise<PermissionCard> {
  const open = await openCard(chatId, askId);
  if (!open) {
    throw new ORPCError("NOT_FOUND", {
      message: "That request was already answered.",
    });
  }
  if (open.card.device !== thisDevice()) {
    throw new ORPCError("BAD_REQUEST", {
      message: `That request needs answering on ${await computerName(open.card.device)}.`,
    });
  }
  return open.card;
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
